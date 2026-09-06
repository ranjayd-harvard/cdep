"""PublicationReady event (AGENTS.md section 35). For now, only a logging
notifier -- no Kafka, no bus. A future production deployment swaps
LoggingPublicationReadyNotifier for an EventBridge/SQS (AWS) or Pub/Sub
(GCP) publisher without any change to services/publication_service.py,
which only ever depends on the PublicationReadyNotifier protocol.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Protocol

import structlog

log = structlog.get_logger(__name__)


@dataclass
class PublicationReady:
    publication_id: str
    exchange_id: str
    organization_id: str
    tenant_id: str
    data_product_id: str
    product_version: str
    format: str
    record_count: int
    status: str


class PublicationReadyNotifier(Protocol):
    def notify(self, event: PublicationReady) -> None: ...


class LoggingPublicationReadyNotifier:
    def notify(self, event: PublicationReady) -> None:
        log.info("publication.ready", **asdict(event))
