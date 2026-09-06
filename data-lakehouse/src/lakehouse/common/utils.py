from __future__ import annotations

import hashlib
import json
from typing import Any


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def stable_record_hash(record: dict[str, Any]) -> str:
    """Deterministic hash of a raw source record, used as a technical
    fingerprint (`_record_hash`) — not a business dedup key."""
    payload = json.dumps(record, sort_keys=True, default=str, separators=(",", ":"))
    return sha256_hex(payload.encode("utf-8"))
