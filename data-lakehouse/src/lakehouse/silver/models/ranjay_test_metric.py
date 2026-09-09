"""Canonical Arrow schema for `silver.ranjay_test_metric`.

Synthetic test entity used to validate onboarding a brand-new data product
end-to-end -- see data-exchange-service/TEST-DataProduct-onboarding.MD.
Field order matters only for readability here -- Iceberg tracks columns by
field-id, and writes are always aligned against `table.schema()` before
`upsert()` (see `silver_writer.py`).
"""

from __future__ import annotations

import pyarrow as pa

SILVER_RANJAY_TEST_METRIC_SCHEMA = pa.schema(
    [
        pa.field("organization_id", pa.string(), nullable=False),
        pa.field("tenant_id", pa.string(), nullable=False),
        pa.field("metric_id", pa.string(), nullable=False),
        pa.field("metric_label", pa.string(), nullable=False),
        pa.field("recorded_on", pa.date32(), nullable=False),
        pa.field("metric_value", pa.decimal128(18, 2), nullable=True),
        pa.field("source_system", pa.string(), nullable=True),
        pa.field("source_exchange_id", pa.string(), nullable=False),
        pa.field("source_ingestion_id", pa.string(), nullable=False),
        pa.field("source_bronze_snapshot_id", pa.string(), nullable=True),
        pa.field("source_record_hash", pa.string(), nullable=True),
        pa.field("pipeline_run_id", pa.string(), nullable=False),
        pa.field("silver_created_at", pa.timestamp("us"), nullable=False),
        pa.field("silver_updated_at", pa.timestamp("us"), nullable=False),
    ]
)

SILVER_RANJAY_TEST_METRIC_BUSINESS_KEY = ["organization_id", "tenant_id", "metric_id"]
