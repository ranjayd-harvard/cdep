"""Silver quarantine mechanism (AGENTS.md section 12).

Mirrors `lakehouse.ingestion.rejects` -- rejected records are never silently
discarded. Written as JSONL under
`lakehouse-silver/silver-rejects/{entity}/{pipeline_run_id}/rejects.jsonl`,
the "equivalent standardized technical namespace" the spec allows in place
of a literal `silver_rejects.event` table (kept as an object-storage JSONL
sink, consistent with how Bronze already quarantines unreadable records --
see README "Reject handling" for the rationale).
"""

from __future__ import annotations

import json
from typing import Any

import structlog

from lakehouse.common.time import utcnow
from lakehouse.pipelines.pipeline_context import PipelineContext
from lakehouse.storage.interface import StorageClient

log = structlog.get_logger(__name__)


def silver_reject_key(entity: str, pipeline_run_id: str) -> str:
    return f"silver-rejects/{entity}/{pipeline_run_id}/rejects.jsonl"


def write_silver_rejects(
    storage: StorageClient,
    *,
    bucket: str,
    entity: str,
    context: PipelineContext,
    rejected: list[dict[str, Any]],
) -> str | None:
    """`rejected` entries: {"raw_record": ..., "error_code": ..., "error_message": ...,
    "failed_rules": [...]}."""
    if not rejected:
        return None

    rejected_at = utcnow().isoformat()
    lines = []
    for r in rejected:
        lines.append(
            json.dumps(
                {
                    "organization_id": context.organization_id,
                    "tenant_id": context.tenant_id,
                    "source_exchange_id": context.source_exchange_id,
                    "source_ingestion_id": context.source_ingestion_id,
                    "pipeline_run_id": context.pipeline_run_id,
                    "raw_record": r.get("raw_record"),
                    "error_code": r.get("error_code", "SILVER_VALIDATION_FAILED"),
                    "error_message": r.get("error_message"),
                    "failed_rules": r.get("failed_rules", []),
                    "rejected_at": rejected_at,
                },
                default=str,
            )
        )

    key = silver_reject_key(entity, context.pipeline_run_id)
    storage.put_bytes(bucket, key, ("\n".join(lines) + "\n").encode("utf-8"), "application/x-ndjson")
    log.info(
        "silver.rejects.written",
        pipeline_run_id=context.pipeline_run_id,
        entity=entity,
        rejected_count=len(rejected),
        path=f"{bucket}/{key}",
    )
    return f"{bucket}/{key}"
