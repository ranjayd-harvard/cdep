"""Parquet exporter (AGENTS.md sections 17/46/49).

Writes a single Parquet file per publication -- acceptable for the Phase 4
local demo dataset size (AGENTS.md section 46, approach A). PublicationArtifact
itself is not single-file-only (section 47): a future large-dataset path
would call this once per partition and register N artifact rows against one
publication_id instead of coalescing to one file. `coalesce(1)`-equivalent
behavior is scoped to this exporter, not baked into the data model.

Validates the file is readable immediately after writing (section 49) by
re-opening it and comparing row counts -- catches a silent truncated write
before it ever reaches the Exchange Service.
"""

from __future__ import annotations

from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq

from publication.common.errors import ExportError
from publication.common.hashing import sha256_file
from publication.models.artifact import ArtifactResult


class ParquetExporter:
    format = "PARQUET"
    content_type = "application/x-parquet"

    def export(
        self,
        table: pa.Table,
        *,
        destination: Path,
        artifact_id: str,
        compression: str | None = "snappy",
        product_version: str,
    ) -> ArtifactResult:
        compression = compression or "snappy"
        # Phase 10 §44: embed the Data Product version as Parquet file-level
        # key-value metadata, in addition to the sidecar manifest -- Parquet
        # readers can recover it without needing the sidecar at all.
        existing_metadata = table.schema.metadata or {}
        versioned_table = table.replace_schema_metadata({**existing_metadata, b"data_product_version": product_version.encode("utf-8")})
        try:
            pq.write_table(versioned_table, destination, compression=compression)
        except Exception as exc:  # noqa: BLE001
            raise ExportError(f"Parquet export failed: {exc}") from exc

        try:
            readback = pq.read_table(destination)
        except Exception as exc:  # noqa: BLE001
            raise ExportError(f"Exported Parquet file is not readable back: {exc}") from exc
        if readback.num_rows != table.num_rows:
            raise ExportError(
                f"Exported Parquet file row count ({readback.num_rows}) does not match "
                f"source row count ({table.num_rows})."
            )

        size_bytes = destination.stat().st_size
        checksum = sha256_file(destination)

        return ArtifactResult(
            artifact_id=artifact_id,
            filename=destination.name,
            format=self.format,
            content_type=self.content_type,
            compression=compression,
            local_path=str(destination),
            size_bytes=size_bytes,
            checksum_algorithm="SHA-256",
            checksum=checksum,
            record_count=table.num_rows,
            product_version=product_version,
        )
