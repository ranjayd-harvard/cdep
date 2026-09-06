from __future__ import annotations

import pyarrow as pa
import pytest

from lakehouse.bronze.schema import (
    METADATA_ARROW_FIELDS,
    build_bronze_schema,
    detect_schema_drift,
    enforce_schema_mode,
)
from lakehouse.common.errors import SchemaValidationError


def test_build_bronze_schema_appends_metadata_columns_as_strings():
    schema = build_bronze_schema(["event_id", "venue_id"])
    names = schema.names
    assert names[:2] == ["event_id", "venue_id"]
    assert names[2:] == [f.name for f in METADATA_ARROW_FIELDS]
    assert schema.field("event_id").type == pa.string()


def test_build_bronze_schema_preserves_native_types_when_provided():
    native = [pa.field("tickets_sold", pa.int64())]
    schema = build_bronze_schema(["tickets_sold"], native_fields=native)
    assert schema.field("tickets_sold").type == pa.int64()


def test_detect_schema_drift_finds_new_and_missing_columns():
    drift = detect_schema_drift(["event_id", "new_col"], ["event_id", "venue_id"])
    assert drift["new_columns"] == ["new_col"]
    assert drift["missing_columns"] == ["venue_id"]


def test_enforce_strict_mode_raises_on_drift():
    drift = {"new_columns": ["new_col"], "missing_columns": []}
    with pytest.raises(SchemaValidationError):
        enforce_schema_mode("STRICT", drift, data_product_id="event-data")


def test_enforce_permissive_mode_allows_drift():
    drift = {"new_columns": ["new_col"], "missing_columns": []}
    enforce_schema_mode("PERMISSIVE", drift, data_product_id="event-data")  # no raise


def test_enforce_strict_mode_allows_no_drift():
    drift = {"new_columns": [], "missing_columns": []}
    enforce_schema_mode("STRICT", drift, data_product_id="event-data")  # no raise
