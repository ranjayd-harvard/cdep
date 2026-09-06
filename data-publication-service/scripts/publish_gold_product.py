#!/usr/bin/env python
"""CLI entrypoint for Phase 4: GoldReady -> Outbound Exchange publication.

Usage:
    python scripts/publish_gold_product.py --pipeline-run-id run-gold-001
    python scripts/publish_gold_product.py --pipeline-run-id run-gold-001 --format CSV
    python scripts/publish_gold_product.py --gold-ready-file samples/gold-ready.json
    python scripts/publish_gold_product.py --pipeline-run-id run-gold-001 --republish

Deliberately accepts only --pipeline-run-id (or a GoldReady JSON file) plus
--format/--republish -- organization_id/tenant_id can never be supplied on
the command line (AGENTS.md section 37): they are always resolved from
trusted GoldReady context (data-lakehouse's own `pipeline_runs` row, or a
GoldReady JSON produced by that same pipeline).
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

import structlog

from publication.config.settings import get_settings
from publication.exchange.client import ExchangeServiceClient
from publication.lakehouse.gold_metadata_reader import resolve_gold_ready_by_pipeline_run_id
from publication.metadata.engine import get_engine
from publication.metadata.migrations import run_migrations
from publication.metadata.repository import PublicationRepository
from publication.models.gold_ready import GoldReadyContext
from publication.models.publication import PublicationStatus
from publication.observability.logging import configure_logging
from publication.services.publication_service import PublicationService

log = structlog.get_logger(__name__)


def _load_gold_ready_from_file(path: str) -> GoldReadyContext:
    with open(path) as f:
        data = json.load(f)
    return GoldReadyContext(**data)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Publish one GoldReady event to an Outbound Exchange.")
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--pipeline-run-id", help="A COMPLETED SILVER_TO_GOLD pipeline_run_id from data-lakehouse")
    source.add_argument("--gold-ready-file", help="Path to a GoldReady JSON file")
    parser.add_argument("--format", choices=["PARQUET", "CSV"], help="Requested export format (defaults to the contract's defaultFormat)")
    parser.add_argument("--republish", action="store_true", help="Force a new publication even if one already exists for this snapshot")
    args = parser.parse_args(argv)

    configure_logging()
    settings = get_settings()

    engine = get_engine()
    run_migrations(engine)
    repo = PublicationRepository(engine)
    exchange_client = ExchangeServiceClient(settings)
    service = PublicationService(settings=settings, repository=repo, exchange_client=exchange_client)

    if args.pipeline_run_id:
        gold_ready = resolve_gold_ready_by_pipeline_run_id(args.pipeline_run_id)
    else:
        gold_ready = _load_gold_ready_from_file(args.gold_ready_file)

    outcome = service.publish(gold_ready, requested_format=args.format, republish=args.republish)

    log.info(
        "publish_gold_product.finished",
        publication_id=outcome.publication_id,
        status=outcome.status,
        output_record_count=outcome.output_record_count,
        outbound_exchange_id=outcome.outbound_exchange_id,
        error_code=outcome.error_code,
    )
    print(outcome.publication_id)

    return 1 if outcome.status == PublicationStatus.FAILED.value else 0


if __name__ == "__main__":
    sys.exit(main())
