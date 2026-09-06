"""Generic Bronze->Silver / Silver->Gold orchestration (AGENTS.md section
32). Reads `lakehouse.pipelines.registry` to know which contract, mapping,
Arrow schema, and business-logic function to wire together for a given
data product -- adding a new entity/Data Product should mean registry +
contract + mapping config, not a new orchestration function.
"""

from __future__ import annotations

from dataclasses import dataclass

import structlog
from pyiceberg.catalog import Catalog
from sqlalchemy import Engine

from lakehouse.catalog.iceberg import scan_ingestion_scoped
from lakehouse.common.errors import LakehouseError, PipelineNotConfiguredError
from lakehouse.common.ids import new_pipeline_run_id
from lakehouse.common.time import utcnow
from lakehouse.config.settings import Settings
from lakehouse.contracts.loader import load_gold_contract, load_silver_contract
from lakehouse.contracts.validator import validate_source_columns
from lakehouse.gold.gold_writer import write_gold
from lakehouse.gold.lineage import attach_gold_lineage
from lakehouse.gold.quality import assert_grain, evaluate_gold_quality
from lakehouse.ingestion.ingestion_repository import IngestionRepository
from lakehouse.lineage.lineage_service import LineageService
from lakehouse.notifications.gold_ready import (
    GoldCompletionNotifier,
    GoldReady,
    LoggingGoldCompletionNotifier,
)
from lakehouse.notifications.silver_ready import (
    LoggingSilverCompletionNotifier,
    SilverCompletionNotifier,
    SilverReady,
)
from lakehouse.pipelines.idempotency import check_pipeline_idempotency
from lakehouse.pipelines.pipeline_context import (
    PipelineContext,
    resolve_bronze_ready,
    resolve_silver_ready,
)
from lakehouse.pipelines.pipeline_repository import PipelineRepository
from lakehouse.pipelines.pipeline_status import PipelineStatus, PipelineType
from lakehouse.pipelines.registry import (
    BRONZE_TO_SILVER_PIPELINES,
    SILVER_ENTITIES,
    SILVER_TO_GOLD_PIPELINES,
)
from lakehouse.quality.engine import persist_quality_results
from lakehouse.silver.canonicalizer import canonicalize_rows
from lakehouse.silver.deduplicator import deduplicate
from lakehouse.silver.quality import evaluate_silver_quality
from lakehouse.silver.rejects import write_silver_rejects
from lakehouse.silver.silver_reader import read_silver_pipeline_run_scoped
from lakehouse.silver.silver_writer import write_silver
from lakehouse.storage.interface import StorageClient
from lakehouse.transformations.mapping import load_mapping

log = structlog.get_logger(__name__)


@dataclass
class PipelineOutcome:
    pipeline_run_id: str
    pipeline_type: str
    status: str
    source_table: str | None = None
    target_table: str | None = None
    input_record_count: int = 0
    output_record_count: int = 0
    rejected_record_count: int = 0
    error_code: str | None = None
    error_message: str | None = None


def run_bronze_to_silver(
    *,
    ingestion_id: str,
    catalog: Catalog,
    settings: Settings,
    storage: StorageClient,
    engine: Engine,
    notifier: SilverCompletionNotifier | None = None,
    reprocess: bool = False,
) -> PipelineOutcome:
    ingestion_repo = IngestionRepository(engine)
    pipeline_repo = PipelineRepository(engine)
    lineage_service = LineageService(engine)
    notifier = notifier or LoggingSilverCompletionNotifier()

    bronze_ready = resolve_bronze_ready(ingestion_repo, catalog, ingestion_id=ingestion_id)

    registration = BRONZE_TO_SILVER_PIPELINES.get(bronze_ready.data_product_id)
    if registration is None:
        raise PipelineNotConfiguredError(
            f"No Bronze->Silver pipeline registered for data_product_id="
            f"'{bronze_ready.data_product_id}'"
        )
    silver_entity_cfg = SILVER_ENTITIES[registration.silver_entity]
    mapping = load_mapping(registration.mapping_id)
    contract = load_silver_contract(silver_entity_cfg.contract_id)
    silver_table_qualified = f"silver.{silver_entity_cfg.table_name}"

    idempotency = check_pipeline_idempotency(
        pipeline_repo,
        pipeline_name=registration.pipeline_name,
        organization_id=bronze_ready.organization_id,
        tenant_id=bronze_ready.tenant_id,
        source_ingestion_id=bronze_ready.ingestion_id,
        source_pipeline_run_id=None,
        pipeline_version=registration.pipeline_version,
        contract_version=contract.version,
        mapping_version=mapping.version,
        reprocess=reprocess,
    )
    if idempotency.should_skip:
        existing = idempotency.existing_run
        return PipelineOutcome(
            pipeline_run_id=existing.pipeline_run_id if existing else "",
            pipeline_type=PipelineType.BRONZE_TO_SILVER.value,
            status=PipelineStatus.SKIPPED_DUPLICATE.value,
            source_table=bronze_ready.bronze_table,
            target_table=silver_table_qualified,
            output_record_count=(existing.output_record_count or 0) if existing else 0,
            rejected_record_count=(existing.rejected_record_count or 0) if existing else 0,
        )

    pipeline_run_id = new_pipeline_run_id()
    context = PipelineContext.for_bronze_to_silver(
        pipeline_run_id=pipeline_run_id,
        pipeline_name=registration.pipeline_name,
        bronze_ready=bronze_ready,
        silver_table=silver_table_qualified,
        pipeline_version=registration.pipeline_version,
        contract_version=contract.version,
        mapping_version=mapping.version,
    )

    pipeline_repo.create_run(
        pipeline_run_id=context.pipeline_run_id,
        pipeline_name=context.pipeline_name,
        pipeline_type=context.pipeline_type,
        organization_id=context.organization_id,
        tenant_id=context.tenant_id,
        source_table=context.source_table,
        target_table=context.target_table,
        source_exchange_id=context.source_exchange_id,
        source_ingestion_id=context.source_ingestion_id,
        source_pipeline_run_id=context.source_pipeline_run_id,
        data_product_id=context.data_product_id,
        pipeline_version=context.pipeline_version,
        contract_version=context.contract_version,
        mapping_version=context.mapping_version,
        source_snapshot_id=context.source_snapshot_id,
        started_at=context.started_at,
    )

    log.info(
        "pipeline.bronze_to_silver.started",
        pipeline_run_id=context.pipeline_run_id,
        ingestion_id=ingestion_id,
        organization_id=context.organization_id,
        tenant_id=context.tenant_id,
    )

    try:
        return _execute_bronze_to_silver(
            context=context,
            bronze_ready=bronze_ready,
            mapping=mapping,
            contract=contract,
            silver_entity_cfg=silver_entity_cfg,
            catalog=catalog,
            settings=settings,
            storage=storage,
            engine=engine,
            pipeline_repo=pipeline_repo,
            lineage_service=lineage_service,
            notifier=notifier,
        )
    except LakehouseError as exc:
        log.error(
            "pipeline.bronze_to_silver.failed",
            pipeline_run_id=context.pipeline_run_id,
            error_code=exc.error_code,
            error_message=exc.message,
        )
        pipeline_repo.mark_failed(context.pipeline_run_id, error_code=exc.error_code, error_message=exc.message)
        return PipelineOutcome(
            pipeline_run_id=context.pipeline_run_id,
            pipeline_type=PipelineType.BRONZE_TO_SILVER.value,
            status=PipelineStatus.FAILED.value,
            source_table=context.source_table,
            target_table=context.target_table,
            error_code=exc.error_code,
            error_message=exc.message,
        )


def _execute_bronze_to_silver(
    *,
    context: PipelineContext,
    bronze_ready,
    mapping,
    contract,
    silver_entity_cfg,
    catalog: Catalog,
    settings: Settings,
    storage: StorageClient,
    engine: Engine,
    pipeline_repo: PipelineRepository,
    lineage_service: LineageService,
    notifier: SilverCompletionNotifier,
) -> PipelineOutcome:
    run_id = context.pipeline_run_id

    pipeline_repo.update_status(run_id, PipelineStatus.READING_SOURCE)
    pipeline_repo.record_event(run_id, "SOURCE_READ_STARTED", {"bronze_table": bronze_ready.bronze_table})
    bronze_table = catalog.load_table(bronze_ready.bronze_table)
    bronze_rows = (
        scan_ingestion_scoped(
            bronze_table,
            organization_id=context.organization_id,
            tenant_id=context.tenant_id,
            ingestion_id=bronze_ready.ingestion_id,
        )
        .to_arrow()
        .to_pylist()
    )
    pipeline_repo.record_event(run_id, "SOURCE_READ_COMPLETED", {"input_record_count": len(bronze_rows)})

    pipeline_repo.update_status(run_id, PipelineStatus.VALIDATING)
    pipeline_repo.record_event(run_id, "VALIDATION_STARTED", {})
    if bronze_rows:
        validate_source_columns(list(bronze_rows[0].keys()), mapping)

    pipeline_repo.update_status(run_id, PipelineStatus.TRANSFORMING)
    pipeline_repo.record_event(run_id, "TRANSFORMATION_STARTED", {})
    now = utcnow()
    canonical_pairs, canonicalization_rejects = canonicalize_rows(
        bronze_rows, mapping=mapping, context=context, now=now
    )
    deduped_records, dropped_duplicates = deduplicate(
        canonical_pairs,
        business_key=contract.business_key,
        order_by=contract.deduplication.order_by,
        tiebreaker=contract.deduplication.tiebreaker,
    )

    pipeline_repo.update_status(run_id, PipelineStatus.QUALITY_CHECK)
    pipeline_repo.record_event(run_id, "QUALITY_CHECK_STARTED", {"record_count": len(deduped_records)})
    evaluations, decision = evaluate_silver_quality(deduped_records, contract)
    persist_quality_results(
        engine,
        pipeline_run_id=run_id,
        organization_id=context.organization_id,
        tenant_id=context.tenant_id,
        layer="SILVER",
        table_name=context.target_table,
        evaluations=evaluations,
    )
    if decision.should_fail_pipeline:
        pipeline_repo.record_event(run_id, "QUALITY_CHECK_FAILED", {"rules": decision.error_rule_names})
        from lakehouse.common.errors import QualityPolicyFailedError

        raise QualityPolicyFailedError(
            f"Silver quality policy failed for rule(s): {decision.error_rule_names}"
        )

    quarantine_indices = decision.quarantine_indices
    valid_records = [r for i, r in enumerate(deduped_records) if i not in quarantine_indices]
    quarantined_records = [r for i, r in enumerate(deduped_records) if i in quarantine_indices]

    reject_entries = [
        {"raw_record": r.bronze_row, "error_code": "SILVER_MAPPING_FAILED", "error_message": r.error}
        for r in canonicalization_rejects
    ] + [
        {
            "raw_record": r,
            "error_code": "SILVER_QUALITY_FAILED",
            "error_message": "Failed one or more ERROR-severity quality rule(s)",
            "failed_rules": decision.error_rule_names,
        }
        for r in quarantined_records
    ]
    if reject_entries:
        write_silver_rejects(
            storage,
            bucket=settings.bucket_silver,
            entity=silver_entity_cfg.entity,
            context=context,
            rejected=reject_entries,
        )

    pipeline_repo.update_status(run_id, PipelineStatus.WRITING)
    pipeline_repo.record_event(run_id, "SILVER_WRITE_STARTED", {"record_count": len(valid_records)})
    write_result = write_silver(
        catalog,
        contract=contract,
        table_name=silver_entity_cfg.table_name,
        schema=silver_entity_cfg.schema,
        date_column=silver_entity_cfg.date_column,
        canonical_records=valid_records,
        settings=settings,
    )
    pipeline_repo.record_event(run_id, "SILVER_WRITE_COMPLETED", {"record_count": write_result.record_count})

    lineage_service.record_edge(
        source_type="bronze_table",
        source_identifier=f"{bronze_ready.bronze_table}@{bronze_ready.bronze_snapshot_id}",
        target_type="silver_table",
        target_identifier=f"{write_result.silver_table}@{write_result.target_snapshot_id}",
        pipeline_run_id=run_id,
        organization_id=context.organization_id,
        tenant_id=context.tenant_id,
    )
    lineage_service.record_edge(
        source_type="ingestion",
        source_identifier=bronze_ready.ingestion_id,
        target_type="silver_table",
        target_identifier=f"{write_result.silver_table}@{write_result.target_snapshot_id}",
        pipeline_run_id=run_id,
        organization_id=context.organization_id,
        tenant_id=context.tenant_id,
    )

    total_rejected = len(canonicalization_rejects) + len(quarantined_records)
    pipeline_repo.mark_completed(
        run_id,
        input_record_count=len(bronze_rows),
        output_record_count=write_result.record_count,
        rejected_record_count=total_rejected,
        target_snapshot_id=write_result.target_snapshot_id,
    )

    silver_ready_event = SilverReady(
        pipeline_run_id=run_id,
        organization_id=context.organization_id,
        tenant_id=context.tenant_id,
        entity=silver_entity_cfg.entity,
        silver_table=write_result.silver_table,
        silver_snapshot_id=write_result.target_snapshot_id,
    )
    notifier.notify(silver_ready_event)
    pipeline_repo.record_event(run_id, "SILVER_READY", {"silver_table": write_result.silver_table})

    log.info(
        "pipeline.bronze_to_silver.completed",
        pipeline_run_id=run_id,
        input_record_count=len(bronze_rows),
        output_record_count=write_result.record_count,
        rejected_record_count=total_rejected,
        dropped_duplicates=dropped_duplicates,
    )

    return PipelineOutcome(
        pipeline_run_id=run_id,
        pipeline_type=PipelineType.BRONZE_TO_SILVER.value,
        status=PipelineStatus.COMPLETED.value,
        source_table=bronze_ready.bronze_table,
        target_table=write_result.silver_table,
        input_record_count=len(bronze_rows),
        output_record_count=write_result.record_count,
        rejected_record_count=total_rejected,
    )


def run_silver_to_gold(
    *,
    silver_pipeline_run_id: str,
    product_id: str,
    catalog: Catalog,
    settings: Settings,
    engine: Engine,
    notifier: GoldCompletionNotifier | None = None,
    reprocess: bool = False,
) -> PipelineOutcome:
    pipeline_repo = PipelineRepository(engine)
    lineage_service = LineageService(engine)
    notifier = notifier or LoggingGoldCompletionNotifier()

    silver_ready = resolve_silver_ready(pipeline_repo, silver_pipeline_run_id=silver_pipeline_run_id)

    registration = SILVER_TO_GOLD_PIPELINES.get(product_id)
    if registration is None:
        raise PipelineNotConfiguredError(f"No Silver->Gold pipeline registered for product_id='{product_id}'")
    contract = load_gold_contract(registration.data_product_id)
    gold_table_qualified = f"gold.{registration.gold_table_name}"

    idempotency = check_pipeline_idempotency(
        pipeline_repo,
        pipeline_name=registration.pipeline_name,
        organization_id=silver_ready.organization_id,
        tenant_id=silver_ready.tenant_id,
        source_ingestion_id=None,
        source_pipeline_run_id=silver_ready.pipeline_run_id,
        pipeline_version=registration.pipeline_version,
        contract_version=contract.version,
        mapping_version=None,
        reprocess=reprocess,
    )
    if idempotency.should_skip:
        existing = idempotency.existing_run
        return PipelineOutcome(
            pipeline_run_id=existing.pipeline_run_id if existing else "",
            pipeline_type=PipelineType.SILVER_TO_GOLD.value,
            status=PipelineStatus.SKIPPED_DUPLICATE.value,
            source_table=silver_ready.silver_table,
            target_table=gold_table_qualified,
            output_record_count=(existing.output_record_count or 0) if existing else 0,
            rejected_record_count=(existing.rejected_record_count or 0) if existing else 0,
        )

    pipeline_run_id = new_pipeline_run_id()
    context = PipelineContext.for_silver_to_gold(
        pipeline_run_id=pipeline_run_id,
        pipeline_name=registration.pipeline_name,
        silver_ready=silver_ready,
        gold_table=gold_table_qualified,
        data_product_id=registration.data_product_id,
        pipeline_version=registration.pipeline_version,
        contract_version=contract.version,
    )

    pipeline_repo.create_run(
        pipeline_run_id=context.pipeline_run_id,
        pipeline_name=context.pipeline_name,
        pipeline_type=context.pipeline_type,
        organization_id=context.organization_id,
        tenant_id=context.tenant_id,
        source_table=context.source_table,
        target_table=context.target_table,
        source_exchange_id=context.source_exchange_id,
        source_ingestion_id=context.source_ingestion_id,
        source_pipeline_run_id=context.source_pipeline_run_id,
        data_product_id=context.data_product_id,
        pipeline_version=context.pipeline_version,
        contract_version=context.contract_version,
        mapping_version=context.mapping_version,
        source_snapshot_id=context.source_snapshot_id,
        started_at=context.started_at,
    )

    log.info(
        "pipeline.silver_to_gold.started",
        pipeline_run_id=context.pipeline_run_id,
        silver_pipeline_run_id=silver_pipeline_run_id,
        organization_id=context.organization_id,
        tenant_id=context.tenant_id,
    )

    try:
        return _execute_silver_to_gold(
            context=context,
            silver_ready=silver_ready,
            registration=registration,
            contract=contract,
            catalog=catalog,
            settings=settings,
            engine=engine,
            pipeline_repo=pipeline_repo,
            lineage_service=lineage_service,
            notifier=notifier,
        )
    except LakehouseError as exc:
        log.error(
            "pipeline.silver_to_gold.failed",
            pipeline_run_id=context.pipeline_run_id,
            error_code=exc.error_code,
            error_message=exc.message,
        )
        pipeline_repo.mark_failed(context.pipeline_run_id, error_code=exc.error_code, error_message=exc.message)
        return PipelineOutcome(
            pipeline_run_id=context.pipeline_run_id,
            pipeline_type=PipelineType.SILVER_TO_GOLD.value,
            status=PipelineStatus.FAILED.value,
            source_table=context.source_table,
            target_table=context.target_table,
            error_code=exc.error_code,
            error_message=exc.message,
        )


def _execute_silver_to_gold(
    *,
    context: PipelineContext,
    silver_ready,
    registration,
    contract,
    catalog: Catalog,
    settings: Settings,
    engine: Engine,
    pipeline_repo: PipelineRepository,
    lineage_service: LineageService,
    notifier: GoldCompletionNotifier,
) -> PipelineOutcome:
    run_id = context.pipeline_run_id
    silver_entity_cfg = SILVER_ENTITIES[registration.source_silver_entity]

    pipeline_repo.update_status(run_id, PipelineStatus.READING_SOURCE)
    pipeline_repo.record_event(run_id, "SOURCE_READ_STARTED", {"silver_table": silver_ready.silver_table})
    silver_rows = read_silver_pipeline_run_scoped(
        catalog,
        table_name=silver_entity_cfg.table_name,
        organization_id=context.organization_id,
        tenant_id=context.tenant_id,
        pipeline_run_id=silver_ready.pipeline_run_id,
    )
    pipeline_repo.record_event(run_id, "SOURCE_READ_COMPLETED", {"input_record_count": len(silver_rows)})

    pipeline_repo.update_status(run_id, PipelineStatus.TRANSFORMING)
    pipeline_repo.record_event(run_id, "TRANSFORMATION_STARTED", {})
    now = utcnow()
    built = registration.builder(silver_rows)
    product_records = [
        attach_gold_lineage(
            r,
            context=context,
            product_id=registration.data_product_id,
            product_version=contract.version,
            now=now,
        )
        for r in built
    ]

    pipeline_repo.update_status(run_id, PipelineStatus.QUALITY_CHECK)
    pipeline_repo.record_event(run_id, "QUALITY_CHECK_STARTED", {"record_count": len(product_records)})
    assert_grain(product_records, contract)

    evaluations, decision = evaluate_gold_quality(product_records, contract)
    persist_quality_results(
        engine,
        pipeline_run_id=run_id,
        organization_id=context.organization_id,
        tenant_id=context.tenant_id,
        layer="GOLD",
        table_name=context.target_table,
        evaluations=evaluations,
    )
    if decision.should_fail_pipeline:
        pipeline_repo.record_event(run_id, "QUALITY_CHECK_FAILED", {"rules": decision.error_rule_names})
        from lakehouse.common.errors import QualityPolicyFailedError

        raise QualityPolicyFailedError(
            f"Gold quality policy failed for rule(s): {decision.error_rule_names}; "
            f"GoldReady withheld for '{contract.data_product_id}'"
        )

    quarantine_indices = decision.quarantine_indices
    valid_records = [r for i, r in enumerate(product_records) if i not in quarantine_indices]
    rejected_count = len(product_records) - len(valid_records)
    if rejected_count:
        log.warning(
            "pipeline.silver_to_gold.records_quarantined",
            pipeline_run_id=run_id,
            rejected_count=rejected_count,
            rules=decision.error_rule_names,
        )

    pipeline_repo.update_status(run_id, PipelineStatus.WRITING)
    pipeline_repo.record_event(run_id, "GOLD_WRITE_STARTED", {"record_count": len(valid_records)})
    write_result = write_gold(
        catalog,
        contract=contract,
        table_name=registration.gold_table_name,
        schema=registration.schema,
        date_column=registration.date_column,
        product_records=valid_records,
        settings=settings,
    )
    pipeline_repo.record_event(run_id, "GOLD_WRITE_COMPLETED", {"record_count": write_result.record_count})

    lineage_service.record_edge(
        source_type="silver_table",
        source_identifier=f"{silver_ready.silver_table}@{silver_ready.silver_snapshot_id}",
        target_type="gold_table",
        target_identifier=f"{write_result.gold_table}@{write_result.target_snapshot_id}",
        pipeline_run_id=run_id,
        organization_id=context.organization_id,
        tenant_id=context.tenant_id,
    )

    pipeline_repo.mark_completed(
        run_id,
        input_record_count=len(silver_rows),
        output_record_count=write_result.record_count,
        rejected_record_count=rejected_count,
        target_snapshot_id=write_result.target_snapshot_id,
    )

    gold_ready_event = GoldReady(
        pipeline_run_id=run_id,
        organization_id=context.organization_id,
        tenant_id=context.tenant_id,
        data_product_id=registration.data_product_id,
        product_version=contract.version,
        gold_table=write_result.gold_table,
        gold_snapshot_id=write_result.target_snapshot_id,
        record_count=write_result.record_count,
    )
    notifier.notify(gold_ready_event)
    pipeline_repo.record_event(run_id, "GOLD_READY", {"gold_table": write_result.gold_table})

    log.info(
        "pipeline.silver_to_gold.completed",
        pipeline_run_id=run_id,
        input_record_count=len(silver_rows),
        output_record_count=write_result.record_count,
        rejected_record_count=rejected_count,
    )

    return PipelineOutcome(
        pipeline_run_id=run_id,
        pipeline_type=PipelineType.SILVER_TO_GOLD.value,
        status=PipelineStatus.COMPLETED.value,
        source_table=silver_ready.silver_table,
        target_table=write_result.gold_table,
        input_record_count=len(silver_rows),
        output_record_count=write_result.record_count,
        rejected_record_count=rejected_count,
    )
