"""Pipeline reconciliation (AGENTS.md section 43).

    python -m lakehouse.pipelines.reconciliation

Extends Phase 2's `lakehouse.ingestion.reconcile` (still the tool for
stuck/crashed *ingestion* runs) with three additional Phase 3 checks:

1. A completed Bronze ingestion with no Bronze->Silver pipeline run at all.
2. A completed Bronze->Silver run with no Silver->Gold run for any of its
   registered Gold products.
3. A pipeline run (either type) stuck in a non-terminal status.

Does not (yet) diff Iceberg snapshot manifests against pipeline_runs to
detect "commit succeeded but metadata update failed" -- same known
limitation Phase 2's reconcile.py documents for ingestion_runs.
"""

from __future__ import annotations

import sys

import structlog

from lakehouse.ingestion.ingestion_repository import IngestionRepository, get_engine
from lakehouse.ingestion.status import IngestionStatus
from lakehouse.observability.logging import configure_logging
from lakehouse.pipelines.pipeline_repository import PipelineRepository
from lakehouse.pipelines.pipeline_status import PipelineType
from lakehouse.pipelines.registry import BRONZE_TO_SILVER_PIPELINES

log = structlog.get_logger(__name__)


def find_bronze_without_silver(
    ingestion_repo: IngestionRepository, pipeline_repo: PipelineRepository
) -> list[str]:
    missing = []
    for run in ingestion_repo.list_recent(limit=500):
        if run.status != IngestionStatus.COMPLETED.value:
            continue
        if run.data_product_id not in BRONZE_TO_SILVER_PIPELINES:
            continue
        silver_runs = [
            r
            for r in pipeline_repo.list_by_source_ingestion(run.ingestion_id)
            if r.pipeline_type == PipelineType.BRONZE_TO_SILVER.value
        ]
        if not silver_runs:
            missing.append(run.ingestion_id)
    return missing


def find_silver_without_gold(pipeline_repo: PipelineRepository) -> list[str]:
    missing = []
    for run in pipeline_repo.list_recent(limit=500):
        if run.pipeline_type != PipelineType.BRONZE_TO_SILVER.value:
            continue
        if run.status != "COMPLETED":
            continue
        expected_products = BRONZE_TO_SILVER_PIPELINES.get(run.data_product_id or "", None)
        expected_gold_products = expected_products.gold_products if expected_products else []
        if not expected_gold_products:
            continue
        gold_runs = [
            r
            for r in pipeline_repo.list_by_source_pipeline_run(run.pipeline_run_id)
            if r.pipeline_type == PipelineType.SILVER_TO_GOLD.value
        ]
        produced_products = {r.data_product_id for r in gold_runs}
        if not set(expected_gold_products).issubset(produced_products):
            missing.append(run.pipeline_run_id)
    return missing


def main() -> int:
    configure_logging()
    engine = get_engine()
    ingestion_repo = IngestionRepository(engine)
    pipeline_repo = PipelineRepository(engine)

    exit_code = 0

    stuck_runs = pipeline_repo.list_non_terminal()
    if stuck_runs:
        exit_code = 1
        for run in stuck_runs:
            log.warning(
                "reconcile.pipeline.stuck",
                pipeline_run_id=run.pipeline_run_id,
                pipeline_type=run.pipeline_type,
                status=run.status,
                started_at=run.started_at.isoformat(),
                recommendation="retry via the same script with --reprocess once root cause is fixed",
            )

    bronze_without_silver = find_bronze_without_silver(ingestion_repo, pipeline_repo)
    if bronze_without_silver:
        exit_code = 1
        for ingestion_id in bronze_without_silver:
            log.warning(
                "reconcile.bronze_without_silver",
                ingestion_id=ingestion_id,
                recommendation="run scripts/run_bronze_to_silver.py --ingestion-id " + ingestion_id,
            )

    silver_without_gold = find_silver_without_gold(pipeline_repo)
    if silver_without_gold:
        exit_code = 1
        for pipeline_run_id in silver_without_gold:
            log.warning(
                "reconcile.silver_without_gold",
                silver_pipeline_run_id=pipeline_run_id,
                recommendation="run scripts/run_silver_to_gold.py --silver-run-id " + pipeline_run_id,
            )

    if exit_code == 0:
        log.info("reconcile.clean", message="No pipeline reconciliation issues found")

    return exit_code


if __name__ == "__main__":
    sys.exit(main())
