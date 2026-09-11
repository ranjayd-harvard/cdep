from __future__ import annotations

from dataclasses import dataclass


@dataclass
class ArtifactResult:
    """Result of exporting one artifact file (AGENTS.md section 17).

    `product_version` (Phase 10 spec §44) makes the Data Product version
    visible in the artifact metadata itself, not just the publication_runs
    DB record and the storage folder name -- see exporters/manifest.py.
    """

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
    product_version: str
