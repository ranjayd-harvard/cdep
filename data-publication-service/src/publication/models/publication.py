"""Publication run status machine (AGENTS.md sections 11/12) and outcome
model returned by the service layer."""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum


class PublicationStatus(str, Enum):
    CREATED = "CREATED"
    READING_GOLD = "READING_GOLD"
    PROJECTING_SCHEMA = "PROJECTING_SCHEMA"
    QUALITY_CHECK = "QUALITY_CHECK"
    EXPORTING = "EXPORTING"
    CALCULATING_CHECKSUM = "CALCULATING_CHECKSUM"
    CREATING_OUTBOUND_EXCHANGE = "CREATING_OUTBOUND_EXCHANGE"
    TRANSFERRING = "TRANSFERRING"
    REGISTERING_ARTIFACT = "REGISTERING_ARTIFACT"
    READY = "READY"
    FAILED = "FAILED"
    EXPIRED = "EXPIRED"
    SKIPPED_DUPLICATE = "SKIPPED_DUPLICATE"


# Ordered pipeline of "forward" states -- used only to make transitions
# explicit/debuggable; FAILED is reachable from any non-terminal state.
_FORWARD_ORDER = [
    PublicationStatus.CREATED,
    PublicationStatus.READING_GOLD,
    PublicationStatus.PROJECTING_SCHEMA,
    PublicationStatus.QUALITY_CHECK,
    PublicationStatus.EXPORTING,
    PublicationStatus.CALCULATING_CHECKSUM,
    PublicationStatus.CREATING_OUTBOUND_EXCHANGE,
    PublicationStatus.TRANSFERRING,
    PublicationStatus.REGISTERING_ARTIFACT,
    PublicationStatus.READY,
]

_TERMINAL = {PublicationStatus.READY, PublicationStatus.FAILED, PublicationStatus.EXPIRED, PublicationStatus.SKIPPED_DUPLICATE}


def assert_valid_transition(current: PublicationStatus, target: PublicationStatus) -> None:
    from publication.common.errors import InvalidStateTransitionError

    if target == PublicationStatus.FAILED:
        return
    if current in _TERMINAL:
        raise InvalidStateTransitionError(f"Cannot transition publication out of terminal state {current.value}")
    try:
        if _FORWARD_ORDER.index(target) < _FORWARD_ORDER.index(current):
            raise InvalidStateTransitionError(f"Cannot move publication backwards from {current.value} to {target.value}")
    except ValueError as exc:
        raise InvalidStateTransitionError(f"Unknown publication status transition {current.value} -> {target.value}") from exc


@dataclass
class PublicationOutcome:
    publication_id: str
    status: str
    organization_id: str
    tenant_id: str
    data_product_id: str
    product_version: str
    source_gold_table: str
    source_gold_snapshot_id: str | None
    input_record_count: int = 0
    output_record_count: int = 0
    artifact_count: int = 0
    outbound_exchange_id: str | None = None
    error_code: str | None = None
    error_message: str | None = None
