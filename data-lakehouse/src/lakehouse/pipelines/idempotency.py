"""Pipeline idempotency (AGENTS.md sections 40-42).

Mirrors `lakehouse.ingestion.idempotency` in spirit: if the same source
(ingestion_id for Bronze->Silver, upstream pipeline_run_id for
Silver->Gold) has already been processed successfully by this exact
pipeline/contract/mapping version combination, skip -- don't duplicate
Silver/Gold data. `--reprocess` bypasses this check explicitly (a new
pipeline_run_id is still always created; prior runs are never overwritten).
"""

from __future__ import annotations

from dataclasses import dataclass

import structlog

from lakehouse.pipelines.pipeline_repository import PipelineRepository, PipelineRun

log = structlog.get_logger(__name__)


@dataclass
class PipelineIdempotencyDecision:
    should_skip: bool
    existing_run: PipelineRun | None = None


def check_pipeline_idempotency(
    repo: PipelineRepository,
    *,
    pipeline_name: str,
    organization_id: str,
    tenant_id: str,
    source_ingestion_id: str | None,
    source_pipeline_run_id: str | None,
    pipeline_version: str,
    contract_version: str,
    mapping_version: str | None,
    reprocess: bool,
) -> PipelineIdempotencyDecision:
    if reprocess:
        log.info(
            "pipeline.idempotency.reprocess_forced",
            pipeline_name=pipeline_name,
            source_ingestion_id=source_ingestion_id,
            source_pipeline_run_id=source_pipeline_run_id,
        )
        return PipelineIdempotencyDecision(should_skip=False)

    existing = repo.find_successful_run(
        pipeline_name=pipeline_name,
        organization_id=organization_id,
        tenant_id=tenant_id,
        source_ingestion_id=source_ingestion_id,
        source_pipeline_run_id=source_pipeline_run_id,
        pipeline_version=pipeline_version,
        contract_version=contract_version,
        mapping_version=mapping_version,
    )
    if existing is None:
        return PipelineIdempotencyDecision(should_skip=False)

    log.info(
        "pipeline.idempotency.duplicate_detected",
        pipeline_name=pipeline_name,
        previous_pipeline_run_id=existing.pipeline_run_id,
    )
    return PipelineIdempotencyDecision(should_skip=True, existing_run=existing)
