from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq

from publication.exporters.csv_exporter import CsvExporter
from publication.exporters.manifest import write_manifest
from publication.exporters.parquet_exporter import ParquetExporter

TABLE = pa.table({"event_id": ["evt-1", "evt-2"], "tickets_sold": [10, None]})


def test_parquet_exporter_roundtrips(tmp_path: Path):
    result = ParquetExporter().export(
        TABLE, destination=tmp_path / "out.parquet", artifact_id="art-1", compression="snappy", product_version="1.3.0"
    )
    assert result.record_count == 2
    assert result.checksum_algorithm == "SHA-256"
    assert len(result.checksum) == 64
    assert Path(result.local_path).exists()
    assert result.size_bytes > 0
    assert result.product_version == "1.3.0"


def test_parquet_exporter_embeds_product_version_in_file_metadata(tmp_path: Path):
    # Phase 10 §44: the version must be visible in the artifact itself, not
    # just the DB record or the storage folder name.
    destination = tmp_path / "out.parquet"
    ParquetExporter().export(TABLE, destination=destination, artifact_id="art-1", compression="snappy", product_version="2.0.0")
    schema = pq.read_schema(destination)
    assert schema.metadata[b"data_product_version"] == b"2.0.0"


def test_csv_exporter_gzips_and_names_file(tmp_path: Path):
    result = CsvExporter().export(TABLE, destination=tmp_path / "out.csv", artifact_id="art-2", compression="gzip", product_version="1.0.0")
    assert result.filename.endswith(".csv.gz")
    assert result.content_type == "application/gzip"
    assert result.record_count == 2
    assert result.product_version == "1.0.0"


def test_csv_exporter_uncompressed(tmp_path: Path):
    result = CsvExporter().export(TABLE, destination=tmp_path / "out.csv", artifact_id="art-3", compression=None, product_version="1.0.0")
    assert result.filename.endswith(".csv")
    assert not result.filename.endswith(".csv.gz")


def test_write_manifest_includes_product_version(tmp_path: Path):
    result = CsvExporter().export(TABLE, destination=tmp_path / "out.csv", artifact_id="art-4", compression=None, product_version="1.4.0")
    manifest_path = write_manifest(result, tmp_path)
    assert manifest_path.exists()
    assert manifest_path.name == f"{result.filename}.manifest.json"
    contents = manifest_path.read_text(encoding="utf-8")
    assert '"product_version": "1.4.0"' in contents
    assert result.checksum in contents
