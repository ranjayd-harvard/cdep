"""ArtifactExporter interface (AGENTS.md section 17)."""

from __future__ import annotations

from pathlib import Path
from typing import Protocol

import pyarrow as pa

from publication.models.artifact import ArtifactResult


class ArtifactExporter(Protocol):
    def export(
        self,
        table: pa.Table,
        *,
        destination: Path,
        artifact_id: str,
        compression: str | None,
        product_version: str,
    ) -> ArtifactResult: ...
