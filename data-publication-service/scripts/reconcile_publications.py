#!/usr/bin/env python
"""Reconciliation (AGENTS.md section 42). Idempotent -- safe to run
repeatedly; makes no changes unless a genuine inconsistency is found and
never invents new data. Not a scheduler -- run manually or via cron/CI.

Detects:
  1. Publication run stuck in a non-terminal status for longer than
     --stale-minutes (default 60) -- almost certainly a crashed process.
  2. Publication row has an outbound_exchange_id but the Exchange Service
     reports it as something other than READY/DOWNLOADED (upload started
     but never completed, or Exchange Service itself failed it).
  3. Publication row is READY locally but the Exchange Service no longer
     agrees (FAILED/EXPIRED) -- surfaced, not auto-corrected.

This script only ever reports findings; it does not retry or mutate any
publication_runs row. Retrying a stuck publication is a conscious operator
action: re-run `publish_gold_product.py` for the same pipeline_run_id
(idempotency naturally reuses the same identity unless the underlying
Gold snapshot changed) or pass --republish.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

import structlog

from publication.common.time import utcnow
from publication.config.settings import get_settings
from publication.exchange.client import ExchangeServiceClient
from publication.metadata.engine import get_engine
from publication.metadata.repository import PublicationRepository
from publication.observability.logging import configure_logging

log = structlog.get_logger(__name__)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Reconcile publication runs against the Exchange Service.")
    parser.add_argument("--stale-minutes", type=int, default=60)
    args = parser.parse_args(argv)

    configure_logging()
    settings = get_settings()
    engine = get_engine()
    repo = PublicationRepository(engine)
    exchange_client = ExchangeServiceClient(settings)

    findings: list[dict] = []

    non_terminal = repo.list_non_terminal()
    for run in non_terminal:
        age_minutes = (utcnow() - run.created_at.replace(tzinfo=utcnow().tzinfo)).total_seconds() / 60 if run.created_at else 0
        if age_minutes >= args.stale_minutes:
            findings.append(
                {
                    "type": "STUCK_NON_TERMINAL",
                    "publication_id": run.publication_id,
                    "status": run.status,
                    "age_minutes": round(age_minutes, 1),
                    "outbound_exchange_id": run.outbound_exchange_id,
                }
            )

        if run.outbound_exchange_id:
            try:
                exchange = exchange_client.get_exchange(run.outbound_exchange_id)
            except Exception as exc:  # noqa: BLE001
                findings.append(
                    {
                        "type": "EXCHANGE_LOOKUP_FAILED",
                        "publication_id": run.publication_id,
                        "outbound_exchange_id": run.outbound_exchange_id,
                        "error": str(exc),
                    }
                )
                continue
            if exchange.status not in ("READY", "DOWNLOADED", "PREPARING"):
                findings.append(
                    {
                        "type": "EXCHANGE_NOT_READY",
                        "publication_id": run.publication_id,
                        "outbound_exchange_id": run.outbound_exchange_id,
                        "local_status": run.status,
                        "exchange_status": exchange.status,
                    }
                )

    ready_runs = [r for r in repo.list_recent(limit=200) if r.status == "READY" and r.outbound_exchange_id]
    for run in ready_runs:
        try:
            exchange = exchange_client.get_exchange(run.outbound_exchange_id)
        except Exception as exc:  # noqa: BLE001
            findings.append(
                {
                    "type": "EXCHANGE_LOOKUP_FAILED",
                    "publication_id": run.publication_id,
                    "outbound_exchange_id": run.outbound_exchange_id,
                    "error": str(exc),
                }
            )
            continue
        if exchange.status in ("FAILED", "EXPIRED"):
            findings.append(
                {
                    "type": "PUBLICATION_READY_BUT_EXCHANGE_NOT",
                    "publication_id": run.publication_id,
                    "outbound_exchange_id": run.outbound_exchange_id,
                    "exchange_status": exchange.status,
                }
            )

    if findings:
        log.warning("reconciliation.findings", count=len(findings), findings=findings)
        for f in findings:
            print(f)
    else:
        log.info("reconciliation.clean", non_terminal_checked=len(non_terminal), ready_checked=len(ready_runs))
        print("No inconsistencies found.")

    return 1 if findings else 0


if __name__ == "__main__":
    sys.exit(main())
