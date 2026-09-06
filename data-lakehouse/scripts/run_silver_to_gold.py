#!/usr/bin/env python
"""CLI entrypoint for a single Silver->Gold pipeline run.

Usage:
    python scripts/run_silver_to_gold.py --silver-run-id run-example-001
    python scripts/run_silver_to_gold.py --silver-run-id run-example-001 --product-id event-performance
    python scripts/run_silver_to_gold.py --silver-run-id run-example-001 --reprocess

If --product-id is omitted, every Gold product registered against the
upstream Bronze data product (`lakehouse.pipelines.registry
.BRONZE_TO_SILVER_PIPELINES[...].gold_products`) is built. Deliberately
accepts *only* --silver-run-id (+ --product-id/--reprocess) -- organization_id
/tenant_id/source table can never be supplied on the command line.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

import structlog

from lakehouse.catalog.catalog import get_catalog
from lakehouse.common.errors import PipelineRunNotFoundError
from lakehouse.config.settings import get_settings
from lakehouse.ingestion.ingestion_repository import get_engine
from lakehouse.observability.logging import configure_logging
from lakehouse.pipelines.pipeline_repository import PipelineRepository
from lakehouse.pipelines.pipeline_runner import run_silver_to_gold
from lakehouse.pipelines.pipeline_status import PipelineStatus
from lakehouse.pipelines.registry import BRONZE_TO_SILVER_PIPELINES

log = structlog.get_logger(__name__)


def _resolve_product_ids(engine, silver_run_id: str, explicit_product_id: str | None) -> list[str]:
    if explicit_product_id:
        return [explicit_product_id]

    run = PipelineRepository(engine).get(silver_run_id)
    if run is None:
        raise PipelineRunNotFoundError(f"No pipeline run found for pipeline_run_id='{silver_run_id}'")
    registration = BRONZE_TO_SILVER_PIPELINES.get(run.data_product_id or "")
    if not registration or not registration.gold_products:
        raise PipelineRunNotFoundError(
            f"No Gold products registered for Bronze data product "
            f"'{run.data_product_id}' (silver run '{silver_run_id}')"
        )
    return registration.gold_products


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run Silver->Gold for one completed Silver run.")
    parser.add_argument("--silver-run-id", required=True, help="A COMPLETED BRONZE_TO_SILVER pipeline_run_id")
    parser.add_argument("--product-id", help="Gold data_product_id; defaults to all registered products")
    parser.add_argument(
        "--reprocess", action="store_true", help="Force a new run even if already processed"
    )
    args = parser.parse_args(argv)

    configure_logging()
    settings = get_settings()
    catalog = get_catalog()
    engine = get_engine()

    product_ids = _resolve_product_ids(engine, args.silver_run_id, args.product_id)

    exit_code = 0
    for product_id in product_ids:
        outcome = run_silver_to_gold(
            silver_pipeline_run_id=args.silver_run_id,
            product_id=product_id,
            catalog=catalog,
            settings=settings,
            engine=engine,
            reprocess=args.reprocess,
        )
        log.info(
            "pipeline.silver_to_gold.run.finished",
            pipeline_run_id=outcome.pipeline_run_id,
            product_id=product_id,
            status=outcome.status,
            source_table=outcome.source_table,
            target_table=outcome.target_table,
            input_record_count=outcome.input_record_count,
            output_record_count=outcome.output_record_count,
            rejected_record_count=outcome.rejected_record_count,
            error_code=outcome.error_code,
        )
        print(outcome.pipeline_run_id)
        if outcome.status == PipelineStatus.FAILED.value:
            exit_code = 1

    return exit_code


if __name__ == "__main__":
    sys.exit(main())
