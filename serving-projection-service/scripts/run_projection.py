#!/usr/bin/env python
"""CLI entrypoint for a Gold -> Serving refresh (spec §8.4). Same shape as
data-publication-service's scripts/publish_gold_product.py: a thin argparse
wrapper around the actual orchestration in
serving_projection.projection.event_performance_projector.

Usage:
    python scripts/run_projection.py --refresh-type FULL
    python scripts/run_projection.py --refresh-type INCREMENTAL
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from serving_projection.lakehouse.iceberg_reader import get_catalog
from serving_projection.metadata.engine import get_engine
from serving_projection.metadata.migrations import run_migrations
from serving_projection.observability.logging import configure_logging
from serving_projection.projection.event_performance_projector import run_full_refresh, run_incremental_refresh


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run a Gold -> Serving projection refresh.")
    parser.add_argument("--refresh-type", choices=["FULL", "INCREMENTAL"], default="FULL")
    args = parser.parse_args(argv)

    configure_logging()
    engine = get_engine()
    run_migrations(engine)
    catalog = get_catalog()

    outcome = run_full_refresh(engine, catalog) if args.refresh_type == "FULL" else run_incremental_refresh(engine, catalog)
    print(json.dumps(asdict(outcome)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
