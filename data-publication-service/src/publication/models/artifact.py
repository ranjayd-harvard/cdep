from __future__ import annotations

from dataclasses import dataclass


@dataclass
class ArtifactResult:
    """Result of exporting one artifact file (AGENTS.md section 17)."""

    artifact_id: str
    filename: str
    format: str
    content_type: str
    compression: str | None
    local_path: str
    size_bytes: int
    checksum_algorithm: str
    checksum: str
    record_count: int
