#!/usr/bin/env python
"""CLI entrypoint for a single Bronze->Silver pipeline run.

Usage:
    python scripts/run_bronze_to_silver.py --ingestion-id ing-example-001
    python scripts/run_bronze_to_silver.py --ingestion-id ing-example-001 --reprocess

Deliberately accepts *only* --ingestion-id (+ --reprocess) -- organization_id/
tenant_id/source table can never be supplied on the command line, mirroring
Phase 2's ingestion_runner.py (AGENTS.md section 7/33/34).
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
from lakehouse.pipelines.pipeline_runner import run_bronze_to_silver
from lakehouse.pipelines.pipeline_status import PipelineStatus
from lakehouse.storage import build_storage_client

log = structlog.get_logger(__name__)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run Bronze->Silver for one completed ingestion.")
    parser.add_argument("--ingestion-id", required=True, help="A COMPLETED Phase 2 ingestion_id")
    parser.add_argument(
        "--reprocess", action="store_true", help="Force a new run even if already processed"
    )
    args = parser.parse_args(argv)

    configure_logging()
    settings = get_settings()
    catalog = get_catalog()
    storage = build_storage_client(settings)
    engine = get_engine()

    outcome = run_bronze_to_silver(
        ingestion_id=args.ingestion_id,
        catalog=catalog,
        settings=settings,
        storage=storage,
        engine=engine,
        reprocess=args.reprocess,
    )

    log.info(
        "pipeline.bronze_to_silver.run.finished",
        pipeline_run_id=outcome.pipeline_run_id,
        status=outcome.status,
        source_table=outcome.source_table,
        target_table=outcome.target_table,
        input_record_count=outcome.input_record_count,
        output_record_count=outcome.output_record_count,
        rejected_record_count=outcome.rejected_record_count,
        error_code=outcome.error_code,
    )
    print(outcome.pipeline_run_id)
    return 0 if outcome.status != PipelineStatus.FAILED.value else 1


if __name__ == "__main__":
    sys.exit(main())
