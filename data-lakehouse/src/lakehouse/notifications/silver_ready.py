from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Protocol

import structlog

log = structlog.get_logger(__name__)


@dataclass
class SilverReady:
    pipeline_run_id: str
    organization_id: str
    tenant_id: str
    entity: str
    silver_table: str
    silver_snapshot_id: str | None


class SilverCompletionNotifier(Protocol):
    def notify(self, event: SilverReady) -> None: ...


class LoggingSilverCompletionNotifier:
    def notify(self, event: SilverReady) -> None:
        log.info("silver.ready", **asdict(event))
