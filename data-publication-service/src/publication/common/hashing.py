"""SHA-256 checksum + schema fingerprint helpers (AGENTS.md sections 45/51).

Never assume an object-store ETag equals this checksum -- ETags for
multipart uploads are not a plain MD5/SHA of the object body. This module
is the only sanctioned way artifact checksums get computed.
"""

from __future__ import annotations

import hashlib
from pathlib import Path


def sha256_file(path: str | Path, *, chunk_size: int = 1024 * 1024) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as f:
        while chunk := f.read(chunk_size):
            digest.update(chunk)
    return digest.hexdigest()


def schema_fingerprint(published_columns: list[tuple[str, str]]) -> str:
    """Deterministic fingerprint of the *published* schema (name, type)
    pairs, in contract-declared order -- lets a future consumer detect a
    contract change between two publications of the same Data Product."""
    canonical = "|".join(f"{name}:{type_}" for name, type_ in published_columns)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()
