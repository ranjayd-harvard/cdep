"""ID generation helpers. Mirrors `publication.common.ids`'s UUIDv7-based,
time-ordered scheme so projection_run_id sorts naturally by creation time."""

from __future__ import annotations

import time
import uuid


def _uuid7() -> uuid.UUID:
    if hasattr(uuid, "uuid7"):
        return uuid.uuid7()  # type: ignore[attr-defined]

    unix_ts_ms = int(time.time() * 1000)
    rand_bytes = uuid.uuid4().bytes[6:]
    ts_bytes = unix_ts_ms.to_bytes(6, byteorder="big")
    value = bytearray(ts_bytes + rand_bytes)
    value[6] = (value[6] & 0x0F) | 0x70
    value[8] = (value[8] & 0x3F) | 0x80
    return uuid.UUID(bytes=bytes(value))


def new_projection_run_id() -> str:
    return f"proj-{_uuid7().hex}"
