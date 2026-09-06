"""Attaches Silver technical lineage columns to a mapped canonical record
(AGENTS.md section 16). A developer must be able to trace:

    silver.event -> pipeline_run -> bronze.event_data -> ingestion_id ->
    exchange_id -> original upload

`source_bronze_snapshot_id`/`source_record_hash` are carried forward from
the Bronze row rather than the pipeline run, since a single pipeline run may
touch many Bronze rows across ingestion runs during reprocessing.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from lakehouse.pipelines.pipeline_context import PipelineContext


def attach_silver_lineage(
    canonical_record: dict[str, Any],
    *,
    bronze_row: dict[str, Any],
    context: PipelineContext,
    now: datetime,
    silver_created_at: datetime | None = None,
) -> dict[str, Any]:
    record = dict(canonical_record)
    record.update(
        {
            "organization_id": context.organization_id,
            "tenant_id": context.tenant_id,
            "source_system": bronze_row.get("_source_system"),
            "source_exchange_id": bronze_row.get("_exchange_id") or context.source_exchange_id,
            "source_ingestion_id": bronze_row.get("_ingestion_id") or context.source_ingestion_id,
            "source_bronze_snapshot_id": context.source_snapshot_id,
            "source_record_hash": bronze_row.get("_record_hash"),
            "pipeline_run_id": context.pipeline_run_id,
            "silver_created_at": silver_created_at or now,
            "silver_updated_at": now,
        }
    )
    return record
