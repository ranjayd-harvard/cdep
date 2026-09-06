"""Ingestion orchestration: Exchange resolution -> manifest validation ->
technical validation -> idempotency -> read -> Bronze write -> status
callbacks -> BronzeReady (AGENTS.md sections 1/9/10/16/35/47).
"""

from __future__ import annotations

from dataclasses import dataclass

import structlog
from pyiceberg.catalog import Catalog

from lakehouse.bronze.bronze_table import qualified_name
from lakehouse.bronze.bronze_writer import write_bronze
from lakehouse.bronze.notifier import BronzeCompletionNotifier, BronzeReady
from lakehouse.bronze.schema import detect_schema_drift, enforce_schema_mode
from lakehouse.common.errors import LakehouseError
from lakehouse.common.ids import new_ingestion_id
from lakehouse.common.time import utcnow
from lakehouse.config.models import DataProductContract
from lakehouse.config.settings import Settings, load_data_product_contract_dict
from lakehouse.exchange.client import ExchangeServiceClient
from lakehouse.exchange.validation import (
    assert_exchange_ready_for_ingestion,
    assert_manifest_matches_exchange,
)
from lakehouse.ingestion.idempotency import check_idempotency
from lakehouse.ingestion.ingestion_context import IngestionContext
from lakehouse.ingestion.ingestion_repository import IngestionRepository
from lakehouse.ingestion.rejects import write_rejects
from lakehouse.ingestion.status import IngestionStatus
from lakehouse.observability.logging import bind_ingestion_context, clear_ingestion_context
from lakehouse.observability.metrics import IngestionMetrics, emit_ingestion_metrics
from lakehouse.quality.technical_validation import validate_technical_preconditions
from lakehouse.readers import build_reader
from lakehouse.storage.interface import StorageClient

log = structlog.get_logger(__name__)


@dataclass
class IngestionOutcome:
    ingestion_id: str
    exchange_id: str
    status: IngestionStatus
    bronze_table: str | None = None
    source_record_count: int = 0
    bronze_record_count: int = 0
    rejected_record_count: int = 0
    error_code: str | None = None
    error_message: str | None = None


class IngestionService:
    def __init__(
        self,
        *,
        settings: Settings,
        storage: StorageClient,
        catalog: Catalog,
        exchange_client: ExchangeServiceClient,
        repo: IngestionRepository,
        notifier: BronzeCompletionNotifier,
        source_storage: StorageClient | None = None,
    ) -> None:
        self._settings = settings
        self._storage = storage
        # The exchange-inbound object store (where the manifest's file
        # actually lives) is not always the same store as the lakehouse's
        # own Bronze/Silver/Gold storage -- e.g. a real data-exchange-service
        # instance has its own MinIO/S3. Defaults to `storage` for the mock
        # client, where fixtures are staged into the lakehouse's own store.
        self._source_storage = source_storage or storage
        self._catalog = catalog
        self._exchange_client = exchange_client
        self._repo = repo
        self._notifier = notifier

    def run(self, exchange_id: str) -> IngestionOutcome:
        start = utcnow()

        exchange = self._exchange_client.get_exchange(exchange_id)
        assert_exchange_ready_for_ingestion(exchange)

        manifest = self._exchange_client.get_manifest(exchange_id)
        assert_manifest_matches_exchange(manifest, exchange)

        contract = DataProductContract.from_yaml_dict(
            load_data_product_contract_dict(exchange.data_product_id)
        )
        bronze_table_name = qualified_name(contract.bronze)

        idempotency = check_idempotency(
            self._repo,
            exchange_id=exchange_id,
            data_product_id=exchange.data_product_id,
            schema_version=exchange.schema_version,
            source_checksum=manifest.file.checksum,
        )
        if idempotency.should_skip:
            existing = idempotency.existing_run
            return IngestionOutcome(
                ingestion_id=existing.ingestion_id if existing else "",
                exchange_id=exchange_id,
                status=IngestionStatus.SKIPPED_DUPLICATE,
                bronze_table=existing.bronze_table if existing else bronze_table_name,
                source_record_count=existing.source_record_count or 0 if existing else 0,
                bronze_record_count=existing.bronze_record_count or 0 if existing else 0,
                rejected_record_count=existing.rejected_record_count or 0 if existing else 0,
            )

        ingestion_id = new_ingestion_id()
        context = IngestionContext.create(
            ingestion_id=ingestion_id, exchange=exchange, manifest=manifest
        )

        bind_ingestion_context(
            ingestion_id=ingestion_id,
            exchange_id=exchange_id,
            organization_id=exchange.organization_id,
            tenant_id=exchange.tenant_id,
            data_product_id=exchange.data_product_id,
        )

        self._repo.create_run(
            ingestion_id=ingestion_id,
            exchange_id=exchange_id,
            organization_id=exchange.organization_id,
            tenant_id=exchange.tenant_id,
            data_product_id=exchange.data_product_id,
            schema_version=exchange.schema_version,
            source_filename=manifest.file.original_filename,
            source_format=manifest.file.format,
            source_checksum=manifest.file.checksum,
            bronze_table=bronze_table_name,
            started_at=context.ingestion_started_at,
        )

        try:
            outcome = self._execute(context, exchange, manifest, contract, ingestion_id)
            duration_ms = int((utcnow() - start).total_seconds() * 1000)
            emit_ingestion_metrics(
                IngestionMetrics(
                    ingestion_id=ingestion_id,
                    exchange_id=exchange_id,
                    organization_id=exchange.organization_id,
                    tenant_id=exchange.tenant_id,
                    data_product_id=exchange.data_product_id,
                    status=outcome.status.value,
                    source_record_count=outcome.source_record_count,
                    bronze_record_count=outcome.bronze_record_count,
                    rejected_record_count=outcome.rejected_record_count,
                    duration_ms=duration_ms,
                    input_size_bytes=manifest.file.size_bytes,
                )
            )
            return outcome
        except LakehouseError as exc:
            log.error("ingestion.failed", error_code=exc.error_code, error_message=exc.message)
            self._repo.mark_failed(
                ingestion_id, error_code=exc.error_code, error_message=exc.message
            )
            self._exchange_client.mark_ingestion_failed(exchange_id, ingestion_id, exc.error_code)
            return IngestionOutcome(
                ingestion_id=ingestion_id,
                exchange_id=exchange_id,
                status=IngestionStatus.FAILED,
                bronze_table=bronze_table_name,
                error_code=exc.error_code,
                error_message=exc.message,
            )
        finally:
            clear_ingestion_context()

    def _execute(
        self,
        context: IngestionContext,
        exchange,
        manifest,
        contract: DataProductContract,
        ingestion_id: str,
    ) -> IngestionOutcome:
        exchange_id = exchange.exchange_id
        validate_technical_preconditions(
            exchange=exchange,
            manifest=manifest,
            contract=contract,
            storage=self._source_storage,
        )

        self._exchange_client.mark_processing(exchange_id, ingestion_id)
        self._repo.update_status(ingestion_id, IngestionStatus.READING_SOURCE)

        reader = build_reader(manifest.file.format, contract)
        with self._source_storage.open(manifest.storage_bucket, manifest.storage_key) as stream:
            read_result = reader.read(stream)

        expected_fields = [f.name for f in contract.schema_.fields]
        drift = detect_schema_drift(read_result.observed_columns, expected_fields)
        enforce_schema_mode(contract.schema_.mode, drift, data_product_id=contract.data_product_id)

        self._repo.update_status(ingestion_id, IngestionStatus.WRITING_BRONZE)
        write_result = write_bronze(
            self._catalog,
            contract=contract,
            context=context,
            manifest=manifest,
            valid_records=read_result.valid_records,
            ingested_at=utcnow(),
            settings=self._settings,
            native_fields=read_result.native_arrow_fields,
        )

        all_rejected = [*read_result.rejected_records, *write_result.coercion_rejects]

        rejected_path = None
        if all_rejected and contract.quality.reject_unreadable_records:
            rejected_path = write_rejects(
                self._storage,
                bucket=self._settings.bucket_bronze,
                context=context,
                rejected=all_rejected,
            )
        if rejected_path:
            log.warning(
                "ingestion.rejects.present",
                ingestion_id=ingestion_id,
                rejected_count=len(all_rejected),
                path=rejected_path,
            )

        self._repo.mark_completed(
            ingestion_id,
            source_record_count=read_result.source_record_count,
            bronze_record_count=write_result.record_count,
            rejected_record_count=len(all_rejected),
        )
        self._exchange_client.mark_ingestion_complete(exchange_id, ingestion_id)
        self._exchange_client.record_ingestion_reference(
            exchange_id, ingestion_id, write_result.bronze_table
        )

        self._notifier.notify(
            BronzeReady(
                ingestion_id=ingestion_id,
                exchange_id=exchange_id,
                organization_id=context.organization_id,
                tenant_id=context.tenant_id,
                data_product_id=context.data_product_id,
                bronze_table=write_result.bronze_table,
            )
        )

        return IngestionOutcome(
            ingestion_id=ingestion_id,
            exchange_id=exchange_id,
            status=IngestionStatus.COMPLETED,
            bronze_table=write_result.bronze_table,
            source_record_count=read_result.source_record_count,
            bronze_record_count=write_result.record_count,
            rejected_record_count=len(all_rejected),
        )
