from __future__ import annotations

import io

import pyarrow as pa
import pyarrow.parquet as pq

from lakehouse.config.models import CsvContractConfig, JsonContractConfig
from lakehouse.readers.csv_reader import CsvReader
from lakehouse.readers.json_reader import JsonReader
from lakehouse.readers.parquet_reader import ParquetReader


def test_csv_reader_preserves_raw_strings():
    csv_bytes = b"event_id,tickets_sold\nEVT1,1200\nEVT2,850\n"
    reader = CsvReader(CsvContractConfig())
    result = reader.read(io.BytesIO(csv_bytes))
    assert result.source_record_count == 2
    assert result.observed_columns == ["event_id", "tickets_sold"]
    # tickets_sold stays a string -- no type inference (AGENTS.md section 20)
    assert result.valid_records[0].data == {"event_id": "EVT1", "tickets_sold": "1200"}


def test_csv_reader_rejects_malformed_row():
    csv_bytes = b"a,b\n1,2\n1,2,3\n4,5\n"
    reader = CsvReader(CsvContractConfig())
    result = reader.read(io.BytesIO(csv_bytes))
    assert result.source_record_count == 3
    assert len(result.valid_records) == 2
    assert len(result.rejected_records) == 1
    assert result.rejected_records[0].row_number == 2


def test_json_reader_parses_ndjson_and_preserves_nesting():
    payload = b'{"a": 1, "nested": {"x": 1}}\n{"a": 2, "nested": {"x": 2}}\n'
    reader = JsonReader(JsonContractConfig())
    result = reader.read(io.BytesIO(payload))
    assert result.source_record_count == 2
    assert result.valid_records[0].data == {"a": 1, "nested": {"x": 1}}


def test_json_reader_rejects_invalid_line():
    payload = b'{"a": 1}\nNOT JSON\n{"a": 2}\n'
    reader = JsonReader(JsonContractConfig())
    result = reader.read(io.BytesIO(payload))
    assert len(result.valid_records) == 2
    assert len(result.rejected_records) == 1


def test_json_reader_rejects_non_object_line():
    payload = b'[1, 2, 3]\n{"a": 1}\n'
    reader = JsonReader(JsonContractConfig())
    result = reader.read(io.BytesIO(payload))
    assert len(result.valid_records) == 1
    assert len(result.rejected_records) == 1


def test_parquet_reader_preserves_native_types():
    table = pa.table({"event_id": ["EVT1"], "tickets_sold": pa.array([1200], type=pa.int64())})
    buf = io.BytesIO()
    pq.write_table(table, buf)
    buf.seek(0)

    result = ParquetReader().read(buf)
    assert result.source_record_count == 1
    assert result.valid_records[0].data == {"event_id": "EVT1", "tickets_sold": 1200}
    assert result.native_arrow_fields is not None
    field_types = {f.name: f.type for f in result.native_arrow_fields}
    assert field_types["tickets_sold"] == pa.int64()
