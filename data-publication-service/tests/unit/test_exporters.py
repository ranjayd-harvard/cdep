from pathlib import Path

import pyarrow as pa

from publication.exporters.csv_exporter import CsvExporter
from publication.exporters.parquet_exporter import ParquetExporter

TABLE = pa.table({"event_id": ["evt-1", "evt-2"], "tickets_sold": [10, None]})


def test_parquet_exporter_roundtrips(tmp_path: Path):
    result = ParquetExporter().export(TABLE, destination=tmp_path / "out.parquet", artifact_id="art-1", compression="snappy")
    assert result.record_count == 2
    assert result.checksum_algorithm == "SHA-256"
    assert len(result.checksum) == 64
    assert Path(result.local_path).exists()
    assert result.size_bytes > 0


def test_csv_exporter_gzips_and_names_file(tmp_path: Path):
    result = CsvExporter().export(TABLE, destination=tmp_path / "out.csv", artifact_id="art-2", compression="gzip")
    assert result.filename.endswith(".csv.gz")
    assert result.content_type == "application/gzip"
    assert result.record_count == 2


def test_csv_exporter_uncompressed(tmp_path: Path):
    result = CsvExporter().export(TABLE, destination=tmp_path / "out.csv", artifact_id="art-3", compression=None)
    assert result.filename.endswith(".csv")
    assert not result.filename.endswith(".csv.gz")
