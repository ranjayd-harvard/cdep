"""Mandatory multi-tenant test (AGENTS.md section 41): two organizations/
tenants ingest into the same logical Bronze table; tenant-scoped queries
never cross tenants."""

from __future__ import annotations

from lakehouse.catalog.iceberg import scan_tenant_scoped, scan_unscoped
from lakehouse.ingestion.status import IngestionStatus

from .conftest import requires_local_stack


def _csv(event_id: str) -> bytes:
    return (
        b"event_id,venue_id,event_date,tickets_sold,gross_revenue\n"
        + f"{event_id},VEN1,2026-09-01,10,100.0\n".encode()
    )


@requires_local_stack
def test_two_tenants_isolated_in_shared_bronze_table(
    service, catalog, data_product, stage_exchange, unique_id
):
    data_product_id, table_name = data_product

    org_a, tenant_a = "org-A", "tenant-A"
    org_b, tenant_b = "org-B", "tenant-B"

    exchange_a = f"exc-{unique_id}-tenant-a"
    exchange_b = f"exc-{unique_id}-tenant-b"

    stage_exchange(
        exchange_id=exchange_a,
        organization_id=org_a,
        tenant_id=tenant_a,
        data_product_id=data_product_id,
        file_bytes=_csv("EVT-A"),
        filename="events.csv",
        fmt="CSV",
    )
    stage_exchange(
        exchange_id=exchange_b,
        organization_id=org_b,
        tenant_id=tenant_b,
        data_product_id=data_product_id,
        file_bytes=_csv("EVT-B"),
        filename="events.csv",
        fmt="CSV",
    )

    assert service.run(exchange_a).status == IngestionStatus.COMPLETED
    assert service.run(exchange_b).status == IngestionStatus.COMPLETED

    table = catalog.load_table(f"bronze.{table_name}")

    rows_a = scan_tenant_scoped(table, organization_id=org_a, tenant_id=tenant_a).to_arrow().to_pylist()
    rows_b = scan_tenant_scoped(table, organization_id=org_b, tenant_id=tenant_b).to_arrow().to_pylist()
    rows_all = scan_unscoped(table).to_arrow().to_pylist()

    assert {r["event_id"] for r in rows_a} == {"EVT-A"}
    assert {r["event_id"] for r in rows_b} == {"EVT-B"}
    assert all(r["_organization_id"] == org_a and r["_tenant_id"] == tenant_a for r in rows_a)
    assert all(r["_organization_id"] == org_b and r["_tenant_id"] == tenant_b for r in rows_b)

    # Tenant A's scoped query must never see Tenant B's rows, and vice versa.
    assert not any(r["_tenant_id"] == tenant_b for r in rows_a)
    assert not any(r["_tenant_id"] == tenant_a for r in rows_b)

    # The privileged cross-tenant scan sees both.
    assert {"EVT-A", "EVT-B"}.issubset({r["event_id"] for r in rows_all})
