from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Protocol

import structlog

log = structlog.get_logger(__name__)


@dataclass
class GoldReady:
    pipeline_run_id: str
    organization_id: str
    tenant_id: str
    data_product_id: str
    product_version: str
    gold_table: str
    gold_snapshot_id: str | None
    record_count: int


class GoldCompletionNotifier(Protocol):
    def notify(self, event: GoldReady) -> None: ...


class LoggingGoldCompletionNotifier:
    def notify(self, event: GoldReady) -> None:
        log.info("gold.ready", **asdict(event))
