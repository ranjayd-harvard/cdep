"""Idempotency (AGENTS.md section 16).

Identifies whether an exchange has already been successfully ingested using
exchange_id + data_product_id + schema_version (+ source_checksum as a
belt-and-braces signal, logged but not required for the decision since the
same exchange_id should never legitimately carry two different files).
"""

from __future__ import annotations

from dataclasses import dataclass

import structlog

from lakehouse.ingestion.ingestion_repository import IngestionRepository, IngestionRun

log = structlog.get_logger(__name__)


@dataclass
class IdempotencyDecision:
    should_skip: bool
    existing_run: IngestionRun | None = None


def check_idempotency(
    repo: IngestionRepository,
    *,
    exchange_id: str,
    data_product_id: str,
    schema_version: str,
    source_checksum: str | None,
) -> IdempotencyDecision:
    existing = repo.find_successful_run(
        exchange_id=exchange_id, data_product_id=data_product_id, schema_version=schema_version
    )
    if existing is None:
        return IdempotencyDecision(should_skip=False)

    if source_checksum and existing.source_checksum and source_checksum != existing.source_checksum:
        log.warning(
            "ingestion.idempotency.checksum_mismatch",
            exchange_id=exchange_id,
            previous_ingestion_id=existing.ingestion_id,
            previous_checksum=existing.source_checksum,
            incoming_checksum=source_checksum,
        )

    log.info(
        "ingestion.idempotency.duplicate_detected",
        exchange_id=exchange_id,
        previous_ingestion_id=existing.ingestion_id,
    )
    return IdempotencyDecision(should_skip=True, existing_run=existing)
