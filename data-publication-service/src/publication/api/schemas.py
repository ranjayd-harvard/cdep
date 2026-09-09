from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel


class TriggerPublishIn(BaseModel):
    # Two mutually exclusive ways to identify the GoldReady to publish:
    #  1. pipeline_run_id -- the original CLI/portal path (AGENTS.md section 37).
    #  2. organization_id/tenant_id/data_product_id/product_version -- the
    #     Phase 7 Scheduler path. The Scheduler resolves a Catalog version
    #     policy (1.x, latest, ...) down to a concrete version itself; it
    #     never learns or invents a pipeline_run_id (Gold/pipeline
    #     resolution stays Publication Service's job, not the Scheduler's).
    pipeline_run_id: str | None = None
    organization_id: str | None = None
    tenant_id: str | None = None
    data_product_id: str | None = None
    product_version: str | None = None

    format: str | None = None
    republish: bool = False

    # Phase 7 cross-service idempotency (scheduling-service AGENTS.md section
    # 33): the Scheduler's own deterministic execution key. Checked before
    # any publish work starts, independent of the internal gold_ready-based
    # idempotency_key below -- so a Scheduler retry after a lost response
    # can never create a second artifact for the same scheduled occurrence,
    # even across Gold snapshot changes.
    external_idempotency_key: str | None = None


class PublicationOutcomeOut(BaseModel):
    publication_id: str
    status: str
    organization_id: str
    tenant_id: str
    data_product_id: str
    product_version: str
    source_gold_table: str
    source_gold_snapshot_id: str | None
    input_record_count: int
    output_record_count: int
    artifact_count: int
    outbound_exchange_id: str | None
    error_code: str | None
    error_message: str | None


class PublicationRunOut(BaseModel):
    publication_id: str
    organization_id: str
    tenant_id: str
    data_product_id: str
    product_version: str
    source_gold_table: str
    source_gold_snapshot_id: str | None
    source_pipeline_run_id: str | None
    requested_format: str | None
    status: str
    input_record_count: int | None
    output_record_count: int | None
    artifact_count: int | None
    outbound_exchange_id: str | None
    started_at: datetime | None
    completed_at: datetime | None
    error_code: str | None
    error_message: str | None
    created_at: datetime


class PublicationArtifactOut(BaseModel):
    artifact_id: str
    filename: str
    format: str
    content_type: str | None
    compression: str | None
    size_bytes: int | None
    checksum_algorithm: str | None
    checksum: str | None
    record_count: int | None


class PublicationQualityResultOut(BaseModel):
    rule_name: str
    severity: str
    total_count: int | None
    failed_count: int | None
    passed: bool


class PublicationRunDetailOut(BaseModel):
    run: PublicationRunOut
    artifacts: list[PublicationArtifactOut]
    quality_results: list[PublicationQualityResultOut]
