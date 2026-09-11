"""Sidecar manifest writer (Phase 10 spec §44).

"File publication metadata must include the version... make version
visible in manifest metadata... do not rely solely on storage folder names
as the source of truth." A sidecar `<filename>.manifest.json` is uniform
across every exporter/format (Parquet already also gets the version as
embedded file-level key-value metadata -- see parquet_exporter.py -- but
CSV has no equivalent native metadata slot, so the manifest is the one
mechanism that works identically for both).
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

from publication.models.artifact import ArtifactResult


def write_manifest(artifact: ArtifactResult, destination_dir: Path) -> Path:
    manifest_path = destination_dir / f"{artifact.filename}.manifest.json"
    manifest = {
        "artifact_id": artifact.artifact_id,
        "filename": artifact.filename,
        "format": artifact.format,
        "product_version": artifact.product_version,
        "checksum_algorithm": artifact.checksum_algorithm,
        "checksum": artifact.checksum,
        "record_count": artifact.record_count,
        "size_bytes": artifact.size_bytes,
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    return manifest_path
