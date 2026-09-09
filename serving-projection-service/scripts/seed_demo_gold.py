#!/usr/bin/env python
"""Demo/test fixture only: writes directly into `gold.event_performance`
via PyIceberg so Phase 8's Tenant A/B demonstration (spec §8.17-§8.19) has
real Gold data to project, without standing up the full ingestion ->
bronze -> silver -> gold pipeline for two fixture tenants.

Schema and grain key are kept in sync by hand with data-lakehouse's own
`lakehouse.gold.products.event_performance.GOLD_EVENT_PERFORMANCE_SCHEMA` --
this script does not import that package (serving-projection-service and
data-lakehouse are separate deployable projects with no shared-code
tooling in this monorepo), but writes the identical column set so a
production Silver->Gold run and this fixture are indistinguishable to the
projector.

Usage:
    python scripts/seed_demo_gold.py --mode initial
    python scripts/seed_demo_gold.py --mode update-tenant-a
"""

from __future__ import annotations

import argparse
import sys
from datetime import date, datetime, timezone
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

import pyarrow as pa

from serving_projection.lakehouse.iceberg_reader import get_catalog

GOLD_EVENT_PERFORMANCE_SCHEMA = pa.schema(
    [
        pa.field("organization_id", pa.string(), nullable=False),
        pa.field("tenant_id", pa.string(), nullable=False),
        pa.field("event_id", pa.string(), nullable=False),
        pa.field("venue_id", pa.string(), nullable=False),
        pa.field("event_date", pa.date32(), nullable=False),
        pa.field("tickets_sold", pa.int64(), nullable=True),
        pa.field("gross_revenue", pa.decimal128(18, 2), nullable=True),
        pa.field("revenue_per_ticket", pa.decimal128(18, 2), nullable=True),
        pa.field("_gold_pipeline_run_id", pa.string(), nullable=False),
        pa.field("_silver_pipeline_run_id", pa.string(), nullable=True),
        pa.field("_product_id", pa.string(), nullable=False),
        pa.field("_product_version", pa.string(), nullable=False),
        pa.field("_created_at", pa.timestamp("us"), nullable=False),
        pa.field("_updated_at", pa.timestamp("us"), nullable=False),
    ]
)

GRAIN_KEY = ["organization_id", "tenant_id", "event_id"]

TENANT_A = {"organization_id": "org-vobis-org-722aea", "tenant_id": "tenant-default-47d849"}
TENANT_B = {"organization_id": "org-northwind-b91cde", "tenant_id": "tenant-north-9a11c2"}


def _get_or_create_table(catalog):
    from pyiceberg.exceptions import NoSuchTableError

    catalog.create_namespace_if_not_exists("gold")
    try:
        return catalog.load_table("gold.event_performance")
    except NoSuchTableError:
        return catalog.create_table("gold.event_performance", schema=GOLD_EVENT_PERFORMANCE_SCHEMA)


def _row(*, tenant: dict, event_id: str, venue_id: str, event_date: date, tickets_sold: int, gross_revenue: str, now: datetime) -> dict:
    gross = Decimal(gross_revenue)
    revenue_per_ticket = (gross / Decimal(tickets_sold)).quantize(Decimal("0.01")) if tickets_sold else None
    return {
        **tenant,
        "event_id": event_id,
        "venue_id": venue_id,
        "event_date": event_date,
        "tickets_sold": tickets_sold,
        "gross_revenue": gross,
        "revenue_per_ticket": revenue_per_ticket,
        "_gold_pipeline_run_id": f"gpr-demo-{now.strftime('%Y%m%dT%H%M%S')}",
        "_silver_pipeline_run_id": f"spr-demo-{now.strftime('%Y%m%dT%H%M%S')}",
        "_product_id": "event-performance",
        "_product_version": "1.0.0",
        "_created_at": now,
        "_updated_at": now,
    }


def seed_initial(table) -> None:
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    records = [
        # spec §8.17: identical event_id (EVT1001) in two different
        # tenants, deliberately different data -- proves event_id is not a
        # global key.
        _row(tenant=TENANT_A, event_id="EVT1001", venue_id="VEN001", event_date=date(2026, 9, 1), tickets_sold=1200, gross_revenue="84000.00", now=now),
        _row(tenant=TENANT_B, event_id="EVT1001", venue_id="VEN999", event_date=date(2026, 9, 1), tickets_sold=3000, gross_revenue="250000.00", now=now),
        # A second row per tenant so pagination/sort demos have more than
        # one page-worth-adjacent row to order deterministically.
        _row(tenant=TENANT_A, event_id="EVT1002", venue_id="VEN001", event_date=date(2026, 9, 5), tickets_sold=800, gross_revenue="42000.00", now=now),
        _row(tenant=TENANT_B, event_id="EVT1002", venue_id="VEN999", event_date=date(2026, 9, 5), tickets_sold=500, gross_revenue="41500.00", now=now),
    ]
    arrow_table = pa.Table.from_pylist(records, schema=GOLD_EVENT_PERFORMANCE_SCHEMA)
    table.upsert(arrow_table, join_cols=GRAIN_KEY)


def update_tenant_a(table) -> None:
    """spec §8.19 incremental-refresh demonstration: mutate only Tenant A's
    EVT1001 row, with a fresh `_updated_at` so the checkpoint-based
    incremental scan picks it up; Tenant B's EVT1001 is untouched."""
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    updated = _row(tenant=TENANT_A, event_id="EVT1001", venue_id="VEN001", event_date=date(2026, 9, 1), tickets_sold=1500, gross_revenue="99000.00", now=now)
    arrow_table = pa.Table.from_pylist([updated], schema=GOLD_EVENT_PERFORMANCE_SCHEMA)
    table.upsert(arrow_table, join_cols=GRAIN_KEY)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Seed demo Gold data for Phase 8.")
    parser.add_argument("--mode", choices=["initial", "update-tenant-a"], default="initial")
    args = parser.parse_args(argv)

    catalog = get_catalog()
    table = _get_or_create_table(catalog)

    if args.mode == "initial":
        seed_initial(table)
    else:
        update_tenant_a(table)

    table.refresh()
    snapshot = table.current_snapshot()
    print(f"gold.event_performance snapshot_id={snapshot.snapshot_id if snapshot else None}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
