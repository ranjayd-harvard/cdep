"""ID generation helpers. Mirrors `lakehouse.common.ids`'s UUIDv7-based,
time-ordered scheme so publication_id/artifact_id sort naturally by
creation time -- see that module for the fallback rationale (Python gains
uuid.uuid7() only in 3.14+)."""

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


def new_publication_id() -> str:
    return f"pub-{_uuid7().hex}"


def new_artifact_id() -> str:
    return f"art-{_uuid7().hex}"
