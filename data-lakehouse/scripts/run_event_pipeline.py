#!/usr/bin/env python
"""End-to-end Bronze->Silver->Gold for one ingestion (AGENTS.md section 32).

Usage:
    python scripts/run_event_pipeline.py --ingestion-id ing-example-001
    python scripts/run_event_pipeline.py --ingestion-id ing-example-001 --reprocess

Runs Bronze->Silver, then Silver->Gold for every Gold product registered
against the ingestion's Bronze data product. Stops (without emitting
GoldReady) if Bronze->Silver fails or is a no-op re-run that produced no new
Silver snapshot to build Gold from would still proceed -- SKIPPED_DUPLICATE
still carries a valid pipeline_run_id, so Silver->Gold runs (and is itself
idempotent) even on a skipped Bronze->Silver.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

import structlog

from lakehouse.catalog.catalog import get_catalog
from lakehouse.config.settings import get_settings
from lakehouse.ingestion.ingestion_repository import get_engine
from lakehouse.observability.logging import configure_logging
from lakehouse.pipelines.pipeline_runner import run_bronze_to_silver, run_silver_to_gold
from lakehouse.pipelines.pipeline_status import PipelineStatus
from lakehouse.pipelines.registry import BRONZE_TO_SILVER_PIPELINES
from lakehouse.storage import build_storage_client

log = structlog.get_logger(__name__)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run Bronze->Silver->Gold end-to-end for one ingestion.")
    parser.add_argument("--ingestion-id", required=True)
    parser.add_argument(
        "--reprocess", action="store_true", help="Force new runs even if already processed"
    )
    args = parser.parse_args(argv)

    configure_logging()
    settings = get_settings()
    catalog = get_catalog()
    storage = build_storage_client(settings)
    engine = get_engine()

    silver_outcome = run_bronze_to_silver(
        ingestion_id=args.ingestion_id,
        catalog=catalog,
        settings=settings,
        storage=storage,
        engine=engine,
        reprocess=args.reprocess,
    )
    log.info(
        "pipeline.event_pipeline.bronze_to_silver.finished",
        pipeline_run_id=silver_outcome.pipeline_run_id,
        status=silver_outcome.status,
        output_record_count=silver_outcome.output_record_count,
        rejected_record_count=silver_outcome.rejected_record_count,
    )

    if silver_outcome.status == PipelineStatus.FAILED.value:
        log.error("pipeline.event_pipeline.aborted", reason="Bronze->Silver failed")
        return 1

    from lakehouse.ingestion.ingestion_repository import IngestionRepository

    ingestion_run = IngestionRepository(engine).get(args.ingestion_id)
    data_product_id = ingestion_run.data_product_id if ingestion_run else None
    registration = BRONZE_TO_SILVER_PIPELINES.get(data_product_id or "")
    gold_products = registration.gold_products if registration else []

    exit_code = 0
    for product_id in gold_products:
        gold_outcome = run_silver_to_gold(
            silver_pipeline_run_id=silver_outcome.pipeline_run_id,
            product_id=product_id,
            catalog=catalog,
            settings=settings,
            engine=engine,
            reprocess=args.reprocess,
        )
        log.info(
            "pipeline.event_pipeline.silver_to_gold.finished",
            pipeline_run_id=gold_outcome.pipeline_run_id,
            product_id=product_id,
            status=gold_outcome.status,
            output_record_count=gold_outcome.output_record_count,
            rejected_record_count=gold_outcome.rejected_record_count,
        )
        if gold_outcome.status == PipelineStatus.FAILED.value:
            exit_code = 1

    return exit_code


if __name__ == "__main__":
    sys.exit(main())
