"""BronzeReady handoff (AGENTS.md section 47).

`BronzeCompletionNotifier` is the seam Silver will eventually consume
through (Kafka, Pub/Sub, EventBridge, a workflow orchestrator...). For
Phase 2 only a logging implementation exists -- no message broker is
introduced yet.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Protocol

import structlog

log = structlog.get_logger(__name__)


@dataclass
class BronzeReady:
    ingestion_id: str
    exchange_id: str
    organization_id: str
    tenant_id: str
    data_product_id: str
    bronze_table: str


class BronzeCompletionNotifier(Protocol):
    def notify(self, event: BronzeReady) -> None: ...


class LoggingBronzeCompletionNotifier:
    def notify(self, event: BronzeReady) -> None:
        log.info("bronze.ready", **asdict(event))
