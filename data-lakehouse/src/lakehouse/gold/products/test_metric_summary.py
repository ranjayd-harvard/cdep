"""`test-metric-summary` Gold Data Product.

Synthetic test data product used to validate onboarding a brand-new data
product end-to-end -- see data-exchange-service/TEST-DataProduct-onboarding.MD.
Derives `metric_value_doubled = metric_value * 2` from `silver.test_metric`,
handling `metric_value is None` safely (never raises -- the derived metric
is simply not computable for that row), the same pattern as
`event_performance.py`'s `compute_revenue_per_ticket`.
"""

from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal
from typing import Any

import pyarrow as pa

GOLD_TEST_METRIC_SUMMARY_SCHEMA = pa.schema(
    [
        pa.field("organization_id", pa.string(), nullable=False),
        pa.field("tenant_id", pa.string(), nullable=False),
        pa.field("metric_id", pa.string(), nullable=False),
        pa.field("metric_label", pa.string(), nullable=False),
        pa.field("recorded_on", pa.date32(), nullable=False),
        pa.field("metric_value", pa.decimal128(18, 2), nullable=True),
        pa.field("metric_value_doubled", pa.decimal128(18, 2), nullable=True),
        pa.field("_gold_pipeline_run_id", pa.string(), nullable=False),
        pa.field("_silver_pipeline_run_id", pa.string(), nullable=True),
        pa.field("_product_id", pa.string(), nullable=False),
        pa.field("_product_version", pa.string(), nullable=False),
        pa.field("_created_at", pa.timestamp("us"), nullable=False),
        pa.field("_updated_at", pa.timestamp("us"), nullable=False),
    ]
)

GOLD_TEST_METRIC_SUMMARY_GRAIN_KEY = ["organization_id", "tenant_id", "metric_id"]

_CENTS = Decimal("0.01")


def compute_metric_value_doubled(metric_value: Any) -> Decimal | None:
    if metric_value is None:
        return None
    return (Decimal(metric_value) * 2).quantize(_CENTS, rounding=ROUND_HALF_UP)


def build_test_metric_summary(silver_rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    records = []
    for row in silver_rows:
        records.append(
            {
                "organization_id": row["organization_id"],
                "tenant_id": row["tenant_id"],
                "metric_id": row["metric_id"],
                "metric_label": row["metric_label"],
                "recorded_on": row["recorded_on"],
                "metric_value": row.get("metric_value"),
                "metric_value_doubled": compute_metric_value_doubled(row.get("metric_value")),
            }
        )
    return records
