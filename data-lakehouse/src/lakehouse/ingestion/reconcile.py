"""Reconciliation command (AGENTS.md section 38).

python -m lakehouse.ingestion.reconcile

Scope for Phase 2: detect ingestion runs stuck in a non-terminal status
(CREATED / READING_SOURCE / WRITING_BRONZE) -- these indicate a crash or
failure between an Exchange Service PROCESSING transition and a Lakehouse
COMPLETED/FAILED outcome. For each one, report whether the source object is
still present (safe to retry via ingestion_runner) or missing.

KNOWN LIMITATION: this does not (yet) detect "Bronze commit exists but
metadata DB update failed" -- that would require diffing Iceberg snapshot
manifests against `ingestion_runs`, which is a reasonable Phase 3 addition
once Silver needs stronger exactly-once guarantees. See README "Known
limitations".
"""

from __future__ import annotations

import sys

import structlog

from lakehouse.config.settings import get_settings
from lakehouse.exchange import build_exchange_client
from lakehouse.ingestion.ingestion_repository import IngestionRepository
from lakehouse.observability.logging import configure_logging
from lakehouse.storage import build_storage_client

log = structlog.get_logger(__name__)


def main() -> int:
    configure_logging()
    settings = get_settings()
    storage = build_storage_client(settings)
    exchange_client = build_exchange_client(settings, storage)
    repo = IngestionRepository()

    stuck_runs = repo.list_non_terminal()
    if not stuck_runs:
        log.info("reconcile.clean", message="No non-terminal ingestion runs found")
        return 0

    for run in stuck_runs:
        try:
            manifest = exchange_client.get_manifest(run.exchange_id)
            source_present = manifest.storage_bucket is not None and storage.exists(
                manifest.storage_bucket, manifest.storage_key
            )
        except Exception as exc:  # noqa: BLE001
            source_present = None
            log.warning(
                "reconcile.manifest_lookup_failed",
                exchange_id=run.exchange_id,
                error=str(exc),
            )

        log.warning(
            "reconcile.stuck_ingestion_found",
            ingestion_id=run.ingestion_id,
            exchange_id=run.exchange_id,
            status=run.status,
            started_at=run.started_at.isoformat(),
            source_present=source_present,
            recommendation=(
                "retry via ingestion_runner (idempotent)"
                if source_present
                else "source missing or unknown; investigate manually before retrying"
            ),
        )

    return 1


if __name__ == "__main__":
    sys.exit(main())
