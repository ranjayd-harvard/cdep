"""Checkpoint abstraction (spec §8.4). Only "timestamp" is implemented today
-- event-performance's Gold table carries a real `_updated_at` column, so an
incremental refresh can push `_updated_at > checkpoint` into the Iceberg
scan itself (see lakehouse/gold_bulk_reader.py). The shape supports adding
"sequence" / "snapshot" / "iceberg_snapshot" / "custom_token" checkpoint
types later without changing the projection_runs schema (`checkpoint` is
already JSONB) or the run-tracking code -- only a new
`resolve_incremental_checkpoint`-style function per type.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any


@dataclass
class TimestampCheckpoint:
    value: datetime

    def to_dict(self) -> dict[str, Any]:
        return {"type": "timestamp", "value": self.value.isoformat()}

    @staticmethod
    def from_dict(data: dict[str, Any]) -> "TimestampCheckpoint":
        if data.get("type") != "timestamp":
            raise ValueError(f"Unsupported checkpoint type: {data.get('type')!r}")
        return TimestampCheckpoint(value=datetime.fromisoformat(data["value"]))


def epoch_checkpoint() -> TimestampCheckpoint:
    return TimestampCheckpoint(value=datetime(1970, 1, 1, tzinfo=timezone.utc))
