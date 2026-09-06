"""PipelineContext (AGENTS.md Phase 3 section 7/33/34).

Built exclusively from trusted operational metadata already persisted by an
earlier, successfully-completed stage:

- Bronze->Silver trusts `lakehouse.ingestion_runs` (Phase 2) -- resolved via
  `resolve_bronze_ready`, keyed *only* by `ingestion_id`.
- Silver->Gold trusts `lakehouse.pipeline_runs` -- resolved via
  `resolve_silver_ready`, keyed *only* by the upstream Bronze->Silver
  `pipeline_run_id`.

Callers (CLI scripts) never supply organization_id/tenant_id/source_table
directly -- exactly the same trust boundary Phase 2's `IngestionContext`
enforces for exchange_id (see AGENTS.md section 9's "no arbitrary source
table/tenant/organization unless explicit internal/platform-admin mode").
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from pyiceberg.catalog import Catalog

from lakehouse.common.errors import BronzeNotReadyError, SilverNotReadyError
from lakehouse.common.time import utcnow
from lakehouse.ingestion.ingestion_repository import IngestionRepository
from lakehouse.ingestion.status import IngestionStatus
from lakehouse.pipelines.pipeline_repository import PipelineRepository
from lakehouse.pipelines.pipeline_status import PipelineStatus, PipelineType


@dataclass(frozen=True)
class BronzeReadyContext:
    ingestion_id: str
    exchange_id: str
    organization_id: str
    tenant_id: str
    data_product_id: str
    bronze_table: str
    bronze_snapshot_id: str | None
    schema_version: str


def resolve_bronze_ready(
    ingestion_repo: IngestionRepository, catalog: Catalog, *, ingestion_id: str
) -> BronzeReadyContext:
    run = ingestion_repo.get(ingestion_id)
    if run is None:
        raise BronzeNotReadyError(f"No ingestion run found for ingestion_id='{ingestion_id}'")
    if run.status != IngestionStatus.COMPLETED.value:
        raise BronzeNotReadyError(
            f"Ingestion '{ingestion_id}' is not COMPLETED (status={run.status}); "
            "Bronze->Silver can only process a completed Bronze write"
        )

    table = catalog.load_table(run.bronze_table)
    snapshot = table.current_snapshot()

    return BronzeReadyContext(
        ingestion_id=run.ingestion_id,
        exchange_id=run.exchange_id,
        organization_id=run.organization_id,
        tenant_id=run.tenant_id,
        data_product_id=run.data_product_id,
        bronze_table=run.bronze_table,
        bronze_snapshot_id=str(snapshot.snapshot_id) if snapshot else None,
        schema_version=run.schema_version,
    )


@dataclass(frozen=True)
class SilverReadyContext:
    pipeline_run_id: str
    organization_id: str
    tenant_id: str
    silver_table: str
    silver_snapshot_id: str | None
    source_exchange_id: str | None
    source_ingestion_id: str | None


def resolve_silver_ready(
    pipeline_repo: PipelineRepository, *, silver_pipeline_run_id: str
) -> SilverReadyContext:
    run = pipeline_repo.get(silver_pipeline_run_id)
    if run is None:
        raise SilverNotReadyError(f"No pipeline run found for pipeline_run_id='{silver_pipeline_run_id}'")
    if run.pipeline_type != PipelineType.BRONZE_TO_SILVER.value:
        raise SilverNotReadyError(
            f"Pipeline run '{silver_pipeline_run_id}' is a {run.pipeline_type} run, "
            "not BRONZE_TO_SILVER"
        )
    if run.status != PipelineStatus.COMPLETED.value:
        raise SilverNotReadyError(
            f"Pipeline run '{silver_pipeline_run_id}' is not COMPLETED (status={run.status}); "
            "Silver->Gold can only process a completed Silver write"
        )

    return SilverReadyContext(
        pipeline_run_id=run.pipeline_run_id,
        organization_id=run.organization_id,
        tenant_id=run.tenant_id,
        silver_table=run.target_table,
        silver_snapshot_id=run.target_snapshot_id,
        source_exchange_id=run.source_exchange_id,
        source_ingestion_id=run.source_ingestion_id,
    )


@dataclass(frozen=True)
class PipelineContext:
    pipeline_run_id: str
    pipeline_name: str
    pipeline_type: PipelineType

    organization_id: str
    tenant_id: str

    source_table: str
    target_table: str

    source_exchange_id: str | None
    source_ingestion_id: str | None
    source_pipeline_run_id: str | None

    data_product_id: str | None

    pipeline_version: str
    contract_version: str
    mapping_version: str | None

    source_snapshot_id: str | None

    started_at: datetime

    @classmethod
    def for_bronze_to_silver(
        cls,
        *,
        pipeline_run_id: str,
        pipeline_name: str,
        bronze_ready: BronzeReadyContext,
        silver_table: str,
        pipeline_version: str,
        contract_version: str,
        mapping_version: str,
    ) -> PipelineContext:
        return cls(
            pipeline_run_id=pipeline_run_id,
            pipeline_name=pipeline_name,
            pipeline_type=PipelineType.BRONZE_TO_SILVER,
            organization_id=bronze_ready.organization_id,
            tenant_id=bronze_ready.tenant_id,
            source_table=bronze_ready.bronze_table,
            target_table=silver_table,
            source_exchange_id=bronze_ready.exchange_id,
            source_ingestion_id=bronze_ready.ingestion_id,
            source_pipeline_run_id=None,
            data_product_id=bronze_ready.data_product_id,
            pipeline_version=pipeline_version,
            contract_version=contract_version,
            mapping_version=mapping_version,
            source_snapshot_id=bronze_ready.bronze_snapshot_id,
            started_at=utcnow(),
        )

    @classmethod
    def for_silver_to_gold(
        cls,
        *,
        pipeline_run_id: str,
        pipeline_name: str,
        silver_ready: SilverReadyContext,
        gold_table: str,
        data_product_id: str,
        pipeline_version: str,
        contract_version: str,
    ) -> PipelineContext:
        return cls(
            pipeline_run_id=pipeline_run_id,
            pipeline_name=pipeline_name,
            pipeline_type=PipelineType.SILVER_TO_GOLD,
            organization_id=silver_ready.organization_id,
            tenant_id=silver_ready.tenant_id,
            source_table=silver_ready.silver_table,
            target_table=gold_table,
            source_exchange_id=silver_ready.source_exchange_id,
            source_ingestion_id=silver_ready.source_ingestion_id,
            source_pipeline_run_id=silver_ready.pipeline_run_id,
            data_product_id=data_product_id,
            pipeline_version=pipeline_version,
            contract_version=contract_version,
            mapping_version=None,
            source_snapshot_id=silver_ready.silver_snapshot_id,
            started_at=utcnow(),
        )
