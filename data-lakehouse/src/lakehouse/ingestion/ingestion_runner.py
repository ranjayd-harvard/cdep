"""CLI entrypoint for a single ingestion run.

Usage:
    python -m lakehouse.ingestion.ingestion_runner --exchange-id exc-example-001

Deliberately accepts *only* --exchange-id (AGENTS.md section 9).
organization_id / tenant_id / source path can never be supplied on the
command line -- they are resolved exclusively from trusted Exchange Service
/ manifest context inside IngestionService.
"""

from __future__ import annotations

import argparse
import sys

import structlog

from lakehouse.bronze.notifier import LoggingBronzeCompletionNotifier
from lakehouse.catalog.catalog import get_catalog
from lakehouse.config.settings import Settings, get_settings
from lakehouse.exchange import build_exchange_client
from lakehouse.ingestion.ingestion_repository import IngestionRepository
from lakehouse.ingestion.ingestion_service import IngestionService
from lakehouse.ingestion.status import IngestionStatus
from lakehouse.observability.logging import configure_logging
from lakehouse.storage import build_exchange_storage_client, build_storage_client

log = structlog.get_logger(__name__)


def build_ingestion_service(settings: Settings | None = None) -> IngestionService:
    """Build the full IngestionService object graph. Shared by the CLI
    entrypoint below and `lakehouse.api.app` so both construct the exact
    same dependencies without duplicating the wiring."""
    settings = settings or get_settings()

    storage = build_storage_client(settings)
    # In "http" mode, the source file lives in a real data-exchange-service
    # instance's own object store -- a different endpoint/credentials than
    # the lakehouse's own Bronze/Silver/Gold storage. In "mock" mode both
    # are the same store (fixtures are staged into it directly).
    source_storage = (
        build_exchange_storage_client(settings) if settings.exchange_client == "http" else storage
    )
    catalog = get_catalog()
    exchange_client = build_exchange_client(settings, storage)
    repo = IngestionRepository()
    notifier = LoggingBronzeCompletionNotifier()

    return IngestionService(
        settings=settings,
        storage=storage,
        source_storage=source_storage,
        catalog=catalog,
        exchange_client=exchange_client,
        repo=repo,
        notifier=notifier,
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Ingest a single exchange into Bronze.")
    parser.add_argument("--exchange-id", required=True, help="Exchange Service exchange_id")
    args = parser.parse_args(argv)

    configure_logging()
    service = build_ingestion_service()

    outcome = service.run(args.exchange_id)

    log.info(
        "ingestion.run.finished",
        ingestion_id=outcome.ingestion_id,
        exchange_id=outcome.exchange_id,
        status=outcome.status.value,
        bronze_table=outcome.bronze_table,
        source_record_count=outcome.source_record_count,
        bronze_record_count=outcome.bronze_record_count,
        rejected_record_count=outcome.rejected_record_count,
    )

    return 0 if outcome.status != IngestionStatus.FAILED else 1


if __name__ == "__main__":
    sys.exit(main())
