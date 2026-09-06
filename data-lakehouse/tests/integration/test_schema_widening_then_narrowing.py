"""Regression test: once PERMISSIVE schema evolution has widened a Bronze
table with an extra column (AGENTS.md section 22), a later, narrower batch
that doesn't have that column must still append successfully (null-padded
for the missing column) rather than fail with a PyArrow "field does not
exist" error. Discovered via real usage of the no-fixed-schema
`ds-event-performance` contract, where successive uploads carry different
ad hoc column sets."""

from __future__ import annotations

from lakehouse.catalog.iceberg import scan_tenant_scoped
from lakehouse.ingestion.status import IngestionStatus

from .conftest import requires_local_stack

WIDE_CSV = (
    b"event_id,venue_id,event_date,tickets_sold,gross_revenue,promo_code\n"
    b"EVT-WIDE-1,VEN1,2026-09-01,100,7000.50,SUMMER25\n"
)
NARROW_CSV = (
    b"event_id,venue_id,event_date,tickets_sold,gross_revenue\n"
    b"EVT-NARROW-1,VEN1,2026-09-02,200,8000.00\n"
)


@requires_local_stack
def test_narrower_batch_after_schema_widening_appends_with_nulls(
    service, catalog, data_product, stage_exchange, unique_id
):
    data_product_id, table_name = data_product
    org, tenant = "org-test-1", "tenant-test-1"

    wide_exchange_id = f"exc-{unique_id}-wide"
    stage_exchange(
        exchange_id=wide_exchange_id,
        organization_id=org,
        tenant_id=tenant,
        data_product_id=data_product_id,
        file_bytes=WIDE_CSV,
        filename="events.csv",
        fmt="CSV",
    )
    wide_outcome = service.run(wide_exchange_id)
    assert wide_outcome.status == IngestionStatus.COMPLETED

    narrow_exchange_id = f"exc-{unique_id}-narrow"
    stage_exchange(
        exchange_id=narrow_exchange_id,
        organization_id=org,
        tenant_id=tenant,
        data_product_id=data_product_id,
        file_bytes=NARROW_CSV,
        filename="events.csv",
        fmt="CSV",
    )
    narrow_outcome = service.run(narrow_exchange_id)
    assert narrow_outcome.status == IngestionStatus.COMPLETED
    assert narrow_outcome.bronze_record_count == 1

    table = catalog.load_table(f"bronze.{table_name}")
    rows = {
        r["event_id"]: r
        for r in scan_tenant_scoped(table, organization_id=org, tenant_id=tenant).to_arrow().to_pylist()
    }
    assert rows["EVT-WIDE-1"]["promo_code"] == "SUMMER25"
    assert rows["EVT-NARROW-1"]["promo_code"] is None
