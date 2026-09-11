"""CSV exporter (AGENTS.md sections 17/46/48).

Writes the whole projected Arrow table via pyarrow.csv in one pass --
acceptable for the small local demo dataset sizes Phase 4 targets
(AGENTS.md section 46, approach A). A large-dataset path would need a
streaming/chunked CSV writer instead of materializing the full table.

- UTF-8, header row, deterministic column order (the Arrow table's own
  column order, which project_published_schema() derives from the
  contract's publishedSchema order).
- Null representation: empty string (pyarrow.csv's default).
- Dates: ISO-8601 (YYYY-MM-DD, pyarrow.csv's default date32 formatting).
- gzip compression when `compression="gzip"`, reflected in filename
  (.csv.gz) and content_type.
"""

from __future__ import annotations

import gzip
import shutil
from pathlib import Path

import pyarrow as pa
import pyarrow.csv as pa_csv

from publication.common.errors import ExportError
from publication.common.hashing import sha256_file
from publication.models.artifact import ArtifactResult

NULL_REPRESENTATION = ""


class CsvExporter:
    format = "CSV"
    content_type = "text/csv"

    def export(
        self,
        table: pa.Table,
        *,
        destination: Path,
        artifact_id: str,
        compression: str | None = "gzip",
        product_version: str,
    ) -> ArtifactResult:
        uncompressed_path = destination.with_suffix("") if destination.suffix == ".gz" else destination

        try:
            table_for_csv = _stringify_dates(table)
            pa_csv.write_csv(
                table_for_csv,
                uncompressed_path,
                write_options=pa_csv.WriteOptions(include_header=True),
            )
        except Exception as exc:  # noqa: BLE001
            raise ExportError(f"CSV export failed: {exc}") from exc

        final_path = uncompressed_path
        content_type = self.content_type
        if compression == "gzip":
            gz_path = uncompressed_path.with_suffix(uncompressed_path.suffix + ".gz")
            with open(uncompressed_path, "rb") as f_in, gzip.open(gz_path, "wb") as f_out:
                shutil.copyfileobj(f_in, f_out)
            uncompressed_path.unlink()
            final_path = gz_path
            content_type = "application/gzip"

        if not final_path.exists() or final_path.stat().st_size == 0:
            raise ExportError("Exported CSV file is missing or empty after write.")

        size_bytes = final_path.stat().st_size
        checksum = sha256_file(final_path)

        return ArtifactResult(
            artifact_id=artifact_id,
            filename=final_path.name,
            format=self.format,
            content_type=content_type,
            compression=compression,
            local_path=str(final_path),
            size_bytes=size_bytes,
            checksum_algorithm="SHA-256",
            checksum=checksum,
            record_count=table.num_rows,
            product_version=product_version,
        )


def _stringify_dates(table: pa.Table) -> pa.Table:
    """pyarrow.csv writes date32 columns as ISO-8601 by default already;
    this exists as an explicit seam in case a future published type
    (timestamp) needs an explicit format applied before CSV serialization."""
    return table
