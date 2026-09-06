"""Reject/quarantine handling (AGENTS.md section 24): unreadable records
are never silently dropped."""

from __future__ import annotations

import json

from lakehouse.catalog.iceberg import scan_tenant_scoped
from lakehouse.ingestion.status import IngestionStatus
from lakehouse.storage.path_builder import reject_key

from .conftest import requires_local_stack

CSV_WITH_ONE_BAD_ROW = (
    b"event_id,venue_id,event_date,tickets_sold,gross_revenue\n"
    b"EVT-OK-1,VEN1,2026-09-01,100,7000.50\n"
    b"EVT-BAD,VEN1,2026-09-02,200,7000.50,EXTRA_COLUMN\n"
    b"EVT-OK-2,VEN1,2026-09-03,300,7000.50\n"
)


@requires_local_stack
def test_unreadable_rows_are_quarantined_not_dropped(
    service, catalog, settings, storage, data_product, stage_exchange, unique_id
):
    data_product_id, table_name = data_product
    exchange_id = f"exc-{unique_id}-rejects"

    stage_exchange(
        exchange_id=exchange_id,
        organization_id="org-test-1",
        tenant_id="tenant-test-1",
        data_product_id=data_product_id,
        file_bytes=CSV_WITH_ONE_BAD_ROW,
        filename="events.csv",
        fmt="CSV",
    )

    outcome = service.run(exchange_id)

    assert outcome.status == IngestionStatus.COMPLETED
    assert outcome.source_record_count == 3
    assert outcome.bronze_record_count == 2
    assert outcome.rejected_record_count == 1

    table = catalog.load_table(f"bronze.{table_name}")
    rows = scan_tenant_scoped(
        table, organization_id="org-test-1", tenant_id="tenant-test-1"
    ).to_arrow().to_pylist()
    assert {r["event_id"] for r in rows} == {"EVT-OK-1", "EVT-OK-2"}

    key = reject_key(data_product_id, outcome.ingestion_id)
    assert storage.exists(settings.bucket_bronze, key)
    with storage.open(settings.bucket_bronze, key) as f:
        lines = f.read().decode("utf-8").strip().splitlines()
    assert len(lines) == 1
    rejected = json.loads(lines[0])
    assert rejected["exchange_id"] == exchange_id
    assert rejected["source_row"] == 2
    assert rejected["error_code"] == "SOURCE_UNREADABLE"
