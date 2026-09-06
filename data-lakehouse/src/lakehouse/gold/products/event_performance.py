"""`event-performance` Gold Data Product (AGENTS.md sections 22-26).

Derives `revenue_per_ticket = gross_revenue / tickets_sold` from
`silver.event`, handling `tickets_sold in (0, None)` safely (never raises a
division-by-zero -- the metric is simply not computable for that row).
"""

from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal
from typing import Any

import pyarrow as pa

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

GOLD_EVENT_PERFORMANCE_GRAIN_KEY = ["organization_id", "tenant_id", "event_id"]

_CENTS = Decimal("0.01")


def compute_revenue_per_ticket(gross_revenue: Any, tickets_sold: Any) -> Decimal | None:
    if gross_revenue is None or tickets_sold in (None, 0):
        return None
    return (Decimal(gross_revenue) / Decimal(tickets_sold)).quantize(
        _CENTS, rounding=ROUND_HALF_UP
    )


def build_event_performance(silver_rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    records = []
    for row in silver_rows:
        records.append(
            {
                "organization_id": row["organization_id"],
                "tenant_id": row["tenant_id"],
                "event_id": row["event_id"],
                "venue_id": row["venue_id"],
                "event_date": row["event_date"],
                "tickets_sold": row.get("tickets_sold"),
                "gross_revenue": row.get("gross_revenue"),
                "revenue_per_ticket": compute_revenue_per_ticket(
                    row.get("gross_revenue"), row.get("tickets_sold")
                ),
            }
        )
    return records
