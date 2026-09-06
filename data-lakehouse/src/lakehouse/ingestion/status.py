"""Internal ingestion lifecycle statuses (AGENTS.md section 15).

Deliberately distinct from Exchange Service statuses -- see
`lakehouse.exchange.client.translate_ingestion_status_to_exchange_status`
for the one-way translation adapter (section 35).
"""

from __future__ import annotations

from enum import StrEnum


class IngestionStatus(StrEnum):
    CREATED = "CREATED"
    READING_SOURCE = "READING_SOURCE"
    WRITING_BRONZE = "WRITING_BRONZE"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"
    SKIPPED_DUPLICATE = "SKIPPED_DUPLICATE"


TERMINAL_STATUSES = {
    IngestionStatus.COMPLETED,
    IngestionStatus.FAILED,
    IngestionStatus.SKIPPED_DUPLICATE,
}
