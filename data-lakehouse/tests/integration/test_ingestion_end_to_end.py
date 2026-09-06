"""CSV / JSON / Parquet -> Bronze, Bronze metadata fields, and Iceberg
append semantics (AGENTS.md section 40)."""

from __future__ import annotations

import io

import pyarrow as pa
import pyarrow.parquet as pq
import pytest

from lakehouse.bronze.metadata_columns import METADATA_COLUMNS
from lakehouse.catalog.iceberg import scan_tenant_scoped
from lakehouse.ingestion.status import IngestionStatus

from .conftest import requires_local_stack

CSV_BYTES = (
    b"event_id,venue_id,event_date,tickets_sold,gross_revenue\n"
    b"EVT1,VEN1,2026-09-01,100,7000.50\n"
    b"EVT2,VEN2,2026-09-02,200,14000.00\n"
)
NDJSON_BYTES = (
    b'{"event_id": "EVT3", "venue_id": "VEN3", "event_date": "2026-09-03", '
    b'"tickets_sold": 300, "gross_revenue": 21000.0}\n'
)


def _parquet_bytes() -> bytes:
    table = pa.table(
        {
            "event_id": ["EVT4"],
            "venue_id": ["VEN4"],
            "event_date": ["2026-09-04"],
            "tickets_sold": pa.array([400], type=pa.int64()),
            "gross_revenue": pa.array([28000.0], type=pa.float64()),
        }
    )
    buf = io.BytesIO()
    pq.write_table(table, buf)
    return buf.getvalue()


@requires_local_stack
@pytest.mark.parametrize(
    "file_bytes,filename,fmt,expected_event_id",
    [
        (CSV_BYTES, "events.csv", "CSV", "EVT1"),
        (NDJSON_BYTES, "events.ndjson", "JSON", "EVT3"),
    ],
)
def test_format_ingests_into_bronze_with_full_lineage(
    service, catalog, data_product, stage_exchange, unique_id, file_bytes, filename, fmt, expected_event_id
):
    data_product_id, table_name = data_product
    exchange_id = f"exc-{unique_id}-{fmt.lower()}"
    stage_exchange(
        exchange_id=exchange_id,
        organization_id="org-test-1",
        tenant_id="tenant-test-1",
        data_product_id=data_product_id,
        file_bytes=file_bytes,
        filename=filename,
        fmt=fmt,
    )

    outcome = service.run(exchange_id)

    assert outcome.status == IngestionStatus.COMPLETED
    assert outcome.rejected_record_count == 0

    table = catalog.load_table(f"bronze.{table_name}")
    rows = scan_tenant_scoped(table, organization_id="org-test-1", tenant_id="tenant-test-1").to_arrow().to_pylist()
    assert len(rows) >= 1
    matching = [r for r in rows if r["event_id"] == expected_event_id]
    assert len(matching) == 1
    row = matching[0]
    for col in METADATA_COLUMNS:
        assert col in row
    assert row["_exchange_id"] == exchange_id
    assert row["_data_product_id"] == data_product_id
    assert row["_source_format"] == fmt


@requires_local_stack
def test_parquet_preserves_numeric_types_via_contract_coercion(
    service, catalog, data_product, stage_exchange, unique_id
):
    data_product_id, table_name = data_product
    exchange_id = f"exc-{unique_id}-parquet"
    stage_exchange(
        exchange_id=exchange_id,
        organization_id="org-test-1",
        tenant_id="tenant-test-1",
        data_product_id=data_product_id,
        file_bytes=_parquet_bytes(),
        filename="events.parquet",
        fmt="PARQUET",
    )

    outcome = service.run(exchange_id)
    assert outcome.status == IngestionStatus.COMPLETED

    table = catalog.load_table(f"bronze.{table_name}")
    arrow_schema = table.schema().as_arrow()
    assert arrow_schema.field("tickets_sold").type == pa.int64()
    assert arrow_schema.field("gross_revenue").type == pa.float64()
    rows = scan_tenant_scoped(table, organization_id="org-test-1", tenant_id="tenant-test-1").to_arrow().to_pylist()
    row = next(r for r in rows if r["event_id"] == "EVT4")
    assert row["tickets_sold"] == 400
    assert row["gross_revenue"] == 28000.0


@requires_local_stack
def test_bronze_is_append_only_across_multiple_ingestions(
    service, catalog, data_product, stage_exchange, unique_id
):
    """Two separate exchanges append to the same table rather than
    overwriting Bronze history (AGENTS.md section 25)."""
    data_product_id, table_name = data_product

    for i, event_id in enumerate(("EVT-A", "EVT-B")):
        exchange_id = f"exc-{unique_id}-append-{i}"
        csv = (
            b"event_id,venue_id,event_date,tickets_sold,gross_revenue\n"
            + f"{event_id},VEN1,2026-09-0{i + 1},10,100.0\n".encode()
        )
        stage_exchange(
            exchange_id=exchange_id,
            organization_id="org-test-1",
            tenant_id="tenant-test-1",
            data_product_id=data_product_id,
            file_bytes=csv,
            filename="events.csv",
            fmt="CSV",
        )
        outcome = service.run(exchange_id)
        assert outcome.status == IngestionStatus.COMPLETED

    table = catalog.load_table(f"bronze.{table_name}")
    rows = scan_tenant_scoped(table, organization_id="org-test-1", tenant_id="tenant-test-1").to_arrow().to_pylist()
    event_ids = {r["event_id"] for r in rows}
    assert {"EVT-A", "EVT-B"}.issubset(event_ids)
    exchange_ids = {r["_exchange_id"] for r in rows}
    assert len(exchange_ids) == 2
