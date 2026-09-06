"""Attaches Gold technical lineage/metadata columns (AGENTS.md section 29).

Deliberately a small, fixed set of `_`-prefixed columns -- the future
Publication layer selects only the contract's customer-facing columns, never
these (AGENTS.md section 49).
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from lakehouse.pipelines.pipeline_context import PipelineContext


def attach_gold_lineage(
    product_record: dict[str, Any],
    *,
    context: PipelineContext,
    product_id: str,
    product_version: str,
    now: datetime,
    created_at: datetime | None = None,
) -> dict[str, Any]:
    record = dict(product_record)
    record.update(
        {
            "_gold_pipeline_run_id": context.pipeline_run_id,
            "_silver_pipeline_run_id": context.source_pipeline_run_id,
            "_product_id": product_id,
            "_product_version": product_version,
            "_created_at": created_at or now,
            "_updated_at": now,
        }
    )
    return record
