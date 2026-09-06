"""ID generation helpers.

Ingestion IDs are UUIDv7-based (time-ordered) so that they sort naturally by
creation time while remaining globally unique. `exchange_id` is never
generated here — it always comes from trusted Exchange Service context.
"""

from __future__ import annotations

import time
import uuid


def _uuid7() -> uuid.UUID:
    """Generate a UUIDv7 (RFC 9562). Python's uuid module gains uuid7() in
    3.14+; this fallback keeps us working on 3.10-3.13 runtimes."""
    if hasattr(uuid, "uuid7"):
        return uuid.uuid7()  # type: ignore[attr-defined]

    unix_ts_ms = int(time.time() * 1000)
    rand_bytes = uuid.uuid4().bytes[6:]
    ts_bytes = unix_ts_ms.to_bytes(6, byteorder="big")
    value = bytearray(ts_bytes + rand_bytes)
    value[6] = (value[6] & 0x0F) | 0x70  # version 7
    value[8] = (value[8] & 0x3F) | 0x80  # variant RFC 4122
    return uuid.UUID(bytes=bytes(value))


def new_ingestion_id() -> str:
    return f"ing-{_uuid7().hex}"


def new_pipeline_run_id() -> str:
    return f"run-{_uuid7().hex}"


def new_lineage_edge_id() -> str:
    return f"lin-{_uuid7().hex}"
