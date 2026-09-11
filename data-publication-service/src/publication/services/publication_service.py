"""The publication orchestrator (AGENTS.md sections 11/18/21/27/28/29).

Enforced sequence, matching the target architecture diagram:

    Resolve contract -> validate GoldReady -> idempotency check
        -> read Gold (tenant-scoped, snapshot-pinned)
        -> cross-tenant safety assertion (inside the reader)
        -> project published schema -> apply masking
        -> quality gate (blocking)
        -> export -> checksum
        -> create OUTBOUND exchange -> upload artifact -> complete exchange
        -> PublicationReady

Never rolls back Gold on any failure (AGENTS.md section 43) -- this class
only ever reads Gold, and only ever writes to its own publication.* tables,
its own local work_dir, and (at the very end) the Exchange Service.
"""

from __future__ import annotations

import re
from pathlib import Path

import structlog

from publication.common.errors import PublicationError, QualityGateFailedError
from publication.common.hashing import schema_fingerprint
from publication.common.ids import new_artifact_id, new_publication_id
from publication.common.time import utcnow
from publication.config.settings import Settings
from publication.contracts.loader import load_publication_contract
from publication.contracts.validator import validate_gold_ready_against_contract
from publication.entitlement.client import EntitlementClient
from publication.exchange.client import ExchangeServiceClient
from publication.exporters.csv_exporter import CsvExporter
from publication.exporters.manifest import write_manifest
from publication.exporters.parquet_exporter import ParquetExporter
from publication.lakehouse.reader import read_gold_for_publication
from publication.metadata.repository import PublicationRepository
from publication.models.contract import PublicationContract
from publication.models.gold_ready import GoldReadyContext
from publication.models.publication import PublicationOutcome, PublicationStatus
from publication.notifications.publication_ready import (
    LoggingPublicationReadyNotifier,
    PublicationReady,
    PublicationReadyNotifier,
)
from publication.quality.publication_quality import evaluate_artifact_readable, evaluate_publication_quality
from publication.transformations.masking import apply_masking
from publication.transformations.projection import assert_no_unauthorized_columns, project_published_schema

log = structlog.get_logger(__name__)

_EXPORTERS = {"PARQUET": ParquetExporter(), "CSV": CsvExporter()}
_FILENAME_SAFE_RE = re.compile(r"[^A-Za-z0-9_.-]")


class PublicationService:
    def __init__(
        self,
        *,
        settings: Settings,
        repository: PublicationRepository,
        exchange_client: ExchangeServiceClient,
        notifier: PublicationReadyNotifier | None = None,
        entitlement_client: EntitlementClient | None = None,
    ) -> None:
        self._settings = settings
        self._repo = repository
        self._exchange = exchange_client
        self._notifier = notifier or LoggingPublicationReadyNotifier()
        self._entitlement = entitlement_client or EntitlementClient(settings)

    def publish(
        self,
        gold_ready: GoldReadyContext,
        *,
        requested_format: str | None = None,
        republish: bool = False,
        external_idempotency_key: str | None = None,
    ) -> PublicationOutcome:
        # Phase 11 (spec §9/§21): re-validated fresh on every call, exactly
        # like scheduling-service's own entitlement check before dispatch --
        # this service no longer trusts that whoever holds the internal API
        # key already checked entitlement upstream. Fails closed: an
        # unconfigured or unreachable subscription-service is a DENY, not a
        # silent ALLOW (spec §37).
        if not self._entitlement.is_entitled(
            organization_id=gold_ready.organization_id,
            tenant_id=gold_ready.tenant_id,
            data_product_id=gold_ready.data_product_id,
        ):
            raise PublicationError(
                f"Tenant '{gold_ready.tenant_id}' is not entitled to data product '{gold_ready.data_product_id}'.",
                error_code="ENTITLEMENT_DENIED",
            )

        # Phase 7 cross-service idempotency check -- checked first and
        # independent of `republish`/the internal gold_ready-based
        # idempotency_key below. A Scheduler retry after a lost response
        # must always short-circuit here rather than re-running publish
        # work, even if a new Gold snapshot landed between attempts.
        if external_idempotency_key:
            existing = self._repo.find_by_external_idempotency_key(external_idempotency_key)
            if existing:
                log.info(
                    "publication.skipped_duplicate_external",
                    publication_id=existing.publication_id,
                    external_idempotency_key=external_idempotency_key,
                )
                return PublicationOutcome(
                    publication_id=existing.publication_id,
                    status=PublicationStatus.SKIPPED_DUPLICATE.value,
                    organization_id=existing.organization_id,
                    tenant_id=existing.tenant_id,
                    data_product_id=existing.data_product_id,
                    product_version=existing.product_version,
                    source_gold_table=existing.source_gold_table,
                    source_gold_snapshot_id=existing.source_gold_snapshot_id,
                    output_record_count=existing.output_record_count or 0,
                    artifact_count=existing.artifact_count or 0,
                    outbound_exchange_id=existing.outbound_exchange_id,
                )

        contract = load_publication_contract(gold_ready.data_product_id)
        validate_gold_ready_against_contract(gold_ready, contract)

        fmt = (requested_format or contract.default_format).upper()
        if fmt not in contract.formats:
            raise PublicationError(
                f"Format '{fmt}' is not supported by contract '{contract.data_product_id}' "
                f"(supported: {contract.formats})",
                error_code="UNSUPPORTED_FORMAT",
            )

        idempotency_key = "|".join(
            [
                gold_ready.organization_id,
                gold_ready.tenant_id,
                gold_ready.data_product_id,
                gold_ready.product_version,
                gold_ready.gold_snapshot_id or "",
                fmt,
                contract.version,
            ]
        )

        if not republish:
            existing = self._repo.find_by_idempotency_key(idempotency_key)
            if existing:
                log.info(
                    "publication.skipped_duplicate",
                    publication_id=existing.publication_id,
                    idempotency_key=idempotency_key,
                )
                return PublicationOutcome(
                    publication_id=existing.publication_id,
                    status=PublicationStatus.SKIPPED_DUPLICATE.value,
                    organization_id=gold_ready.organization_id,
                    tenant_id=gold_ready.tenant_id,
                    data_product_id=gold_ready.data_product_id,
                    product_version=gold_ready.product_version,
                    source_gold_table=gold_ready.gold_table,
                    source_gold_snapshot_id=gold_ready.gold_snapshot_id,
                    output_record_count=existing.output_record_count or 0,
                    artifact_count=existing.artifact_count or 0,
                    outbound_exchange_id=existing.outbound_exchange_id,
                )

        publication_id = new_publication_id()
        structlog.contextvars.bind_contextvars(
            publication_id=publication_id,
            organization_id=gold_ready.organization_id,
            tenant_id=gold_ready.tenant_id,
            data_product_id=gold_ready.data_product_id,
            product_version=gold_ready.product_version,
        )

        self._repo.create_run(
            publication_id=publication_id,
            organization_id=gold_ready.organization_id,
            tenant_id=gold_ready.tenant_id,
            data_product_id=gold_ready.data_product_id,
            product_version=gold_ready.product_version,
            source_gold_table=gold_ready.gold_table,
            source_gold_snapshot_id=gold_ready.gold_snapshot_id,
            source_pipeline_run_id=gold_ready.pipeline_run_id,
            requested_format=fmt,
            contract_version=contract.version,
            idempotency_key=idempotency_key,
            started_at=utcnow(),
            external_idempotency_key=external_idempotency_key,
        )

        try:
            return self._execute(publication_id, gold_ready, contract, fmt)
        except PublicationError as exc:
            log.error("publication.failed", error_code=exc.error_code, error_message=exc.message)
            self._repo.mark_failed(publication_id, error_code=exc.error_code, error_message=exc.message)
            return PublicationOutcome(
                publication_id=publication_id,
                status=PublicationStatus.FAILED.value,
                organization_id=gold_ready.organization_id,
                tenant_id=gold_ready.tenant_id,
                data_product_id=gold_ready.data_product_id,
                product_version=gold_ready.product_version,
                source_gold_table=gold_ready.gold_table,
                source_gold_snapshot_id=gold_ready.gold_snapshot_id,
                error_code=exc.error_code,
                error_message=exc.message,
            )
        except Exception as exc:  # noqa: BLE001 - convert to a stable, persisted error code
            log.error("publication.failed_unexpected", error=str(exc))
            self._repo.mark_failed(publication_id, error_code="UNEXPECTED_ERROR", error_message=str(exc))
            return PublicationOutcome(
                publication_id=publication_id,
                status=PublicationStatus.FAILED.value,
                organization_id=gold_ready.organization_id,
                tenant_id=gold_ready.tenant_id,
                data_product_id=gold_ready.data_product_id,
                product_version=gold_ready.product_version,
                source_gold_table=gold_ready.gold_table,
                source_gold_snapshot_id=gold_ready.gold_snapshot_id,
                error_code="UNEXPECTED_ERROR",
                error_message=str(exc),
            )
        finally:
            structlog.contextvars.clear_contextvars()

    def _execute(
        self,
        publication_id: str,
        gold_ready: GoldReadyContext,
        contract: PublicationContract,
        fmt: str,
    ) -> PublicationOutcome:
        repo = self._repo

        # 1. Read Gold: tenant-scoped, snapshot-pinned, cross-tenant-asserted.
        repo.update_status(publication_id, PublicationStatus.READING_GOLD.value)
        repo.record_event(publication_id, "GOLD_READ_STARTED", {"gold_table": gold_ready.gold_table})
        scoped_read = read_gold_for_publication(gold_ready, contract)
        repo.record_event(
            publication_id,
            "GOLD_READ_COMPLETED",
            {"input_record_count": scoped_read.input_record_count, "resolved_snapshot_id": scoped_read.resolved_snapshot_id},
        )

        # 2. Project the customer-facing schema, then apply masking.
        repo.update_status(publication_id, PublicationStatus.PROJECTING_SCHEMA.value)
        projected = project_published_schema(scoped_read.rows, contract)
        assert_no_unauthorized_columns(projected, contract)
        projected = apply_masking(projected, contract.masking)
        fingerprint = schema_fingerprint([(c.name, c.type) for c in contract.published_schema])
        repo.set_schema_fingerprint(publication_id, fingerprint)
        repo.record_event(publication_id, "SCHEMA_PROJECTED", {"schema_fingerprint": fingerprint, "columns": [c.name for c in contract.published_schema]})

        # 3. Quality gate -- blocking. No OUTBOUND exchange gets created if this fails.
        repo.update_status(publication_id, PublicationStatus.QUALITY_CHECK.value)
        decision = evaluate_publication_quality(
            rows=scoped_read.rows,
            projected_table=projected,
            contract=contract,
            organization_id=gold_ready.organization_id,
            tenant_id=gold_ready.tenant_id,
        )
        repo.record_quality_results(publication_id, decision.results)
        if decision.should_fail_publication:
            repo.record_event(publication_id, "QUALITY_CHECK_FAILED", {"rules": decision.failed_rule_names})
            raise QualityGateFailedError(f"Publication quality gate failed for rule(s): {decision.failed_rule_names}")
        repo.record_event(publication_id, "QUALITY_CHECK_PASSED", {})

        # 4. Export + checksum.
        repo.update_status(publication_id, PublicationStatus.EXPORTING.value)
        filename = self._build_filename(contract, publication_id, fmt)
        artifact_dir = self._settings.work_dir_path / publication_id
        artifact_dir.mkdir(parents=True, exist_ok=True)
        exporter = _EXPORTERS[fmt]
        compression = {"PARQUET": contract.publication.compression.parquet, "CSV": contract.publication.compression.csv}[fmt]
        artifact = exporter.export(
            projected,
            destination=artifact_dir / filename,
            artifact_id=new_artifact_id(),
            compression=compression,
            product_version=gold_ready.product_version,
        )
        write_manifest(artifact, artifact_dir)
        repo.record_event(publication_id, "ARTIFACT_CREATED", {"filename": artifact.filename, "size_bytes": artifact.size_bytes, "product_version": artifact.product_version})

        repo.update_status(publication_id, PublicationStatus.CALCULATING_CHECKSUM.value)
        readability = evaluate_artifact_readable(artifact)
        repo.record_quality_results(publication_id, [readability])
        if not readability.passed:
            raise QualityGateFailedError("Exported artifact failed the post-write readability check.")
        repo.record_event(publication_id, "CHECKSUM_CREATED", {"checksum": artifact.checksum})

        repo.record_artifact(
            artifact_id=artifact.artifact_id,
            publication_id=publication_id,
            filename=artifact.filename,
            format=artifact.format,
            content_type=artifact.content_type,
            compression=artifact.compression,
            size_bytes=artifact.size_bytes,
            checksum_algorithm=artifact.checksum_algorithm,
            checksum=artifact.checksum,
            record_count=artifact.record_count,
            outbound_exchange_id=None,
        )

        # 5. Hand off to the Exchange Service: create -> upload -> complete.
        repo.update_status(publication_id, PublicationStatus.CREATING_OUTBOUND_EXCHANGE.value)
        created = self._exchange.create_outbound_publication(
            organization_id=gold_ready.organization_id,
            tenant_id=gold_ready.tenant_id,
            data_product_id=gold_ready.data_product_id,
            product_version=gold_ready.product_version,
            filename=artifact.filename,
            format=artifact.format,
            size_bytes=artifact.size_bytes,
            record_count=artifact.record_count,
            checksum_algorithm=artifact.checksum_algorithm,
            checksum=artifact.checksum,
            source_publication_id=publication_id,
            expiration_hours=contract.publication.expiration_hours,
        )
        repo.set_outbound_exchange_id(publication_id, created.exchange_id)
        repo.record_event(publication_id, "OUTBOUND_EXCHANGE_CREATED", {"exchange_id": created.exchange_id})

        repo.update_status(publication_id, PublicationStatus.TRANSFERRING.value)
        repo.record_event(publication_id, "ARTIFACT_TRANSFER_STARTED", {"exchange_id": created.exchange_id})
        self._exchange.upload_artifact(created.upload, artifact.local_path)
        repo.record_event(publication_id, "ARTIFACT_TRANSFER_COMPLETED", {"exchange_id": created.exchange_id})

        repo.update_status(publication_id, PublicationStatus.REGISTERING_ARTIFACT.value)
        completed = self._exchange.complete_outbound_publication(
            created.exchange_id,
            publication_id=publication_id,
            gold_snapshot_id=gold_ready.gold_snapshot_id,
            gold_pipeline_run_id=gold_ready.pipeline_run_id,
        )
        repo.record_event(publication_id, "OUTBOUND_EXCHANGE_READY", {"exchange_id": completed.exchange_id, "status": completed.status})

        repo.mark_ready(
            publication_id,
            input_record_count=scoped_read.input_record_count,
            output_record_count=artifact.record_count,
            artifact_count=1,
            outbound_exchange_id=completed.exchange_id,
        )

        # Temporary local artifact is customer-inaccessible working storage
        # (AGENTS.md section 20) -- delete now that the handoff succeeded.
        Path(artifact.local_path).unlink(missing_ok=True)

        self._notifier.notify(
            PublicationReady(
                publication_id=publication_id,
                exchange_id=completed.exchange_id,
                organization_id=gold_ready.organization_id,
                tenant_id=gold_ready.tenant_id,
                data_product_id=gold_ready.data_product_id,
                product_version=gold_ready.product_version,
                format=fmt,
                record_count=artifact.record_count,
                status="READY",
            )
        )

        return PublicationOutcome(
            publication_id=publication_id,
            status=PublicationStatus.READY.value,
            organization_id=gold_ready.organization_id,
            tenant_id=gold_ready.tenant_id,
            data_product_id=gold_ready.data_product_id,
            product_version=gold_ready.product_version,
            source_gold_table=gold_ready.gold_table,
            source_gold_snapshot_id=gold_ready.gold_snapshot_id,
            input_record_count=scoped_read.input_record_count,
            output_record_count=artifact.record_count,
            artifact_count=1,
            outbound_exchange_id=completed.exchange_id,
        )

    @staticmethod
    def _build_filename(contract: PublicationContract, publication_id: str, fmt: str) -> str:
        date_str = utcnow().strftime("%Y%m%d")
        base = contract.publication.filename_pattern.format(date=date_str, publicationId=publication_id)
        base = _FILENAME_SAFE_RE.sub("_", base)
        extension = {"PARQUET": ".parquet", "CSV": ".csv"}[fmt]
        if fmt == "CSV" and contract.publication.compression.csv == "gzip":
            extension += ".gz"
        return f"{base}{extension}"
