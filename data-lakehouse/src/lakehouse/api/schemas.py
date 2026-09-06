from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel


class TriggerIngestionIn(BaseModel):
    exchange_id: str


class IngestionRunOut(BaseModel):
    ingestion_id: str
    exchange_id: str
    organization_id: str
    tenant_id: str
    data_product_id: str
    schema_version: str
    bronze_table: str
    status: str
    started_at: datetime
    completed_at: datetime | None
    source_record_count: int | None
    bronze_record_count: int | None
    rejected_record_count: int | None
    error_code: str | None
    error_message: str | None
    created_at: datetime


class IngestionOutcomeOut(BaseModel):
    ingestion_id: str
    exchange_id: str
    status: str
    bronze_table: str | None
    source_record_count: int
    bronze_record_count: int
    rejected_record_count: int
    error_code: str | None
    error_message: str | None


# --- Phase 3: pipeline runs (Bronze->Silver / Silver->Gold) -----------------


class TriggerBronzeToSilverIn(BaseModel):
    ingestion_id: str
    reprocess: bool = False


class TriggerSilverToGoldIn(BaseModel):
    silver_run_id: str
    # When omitted, every Gold product registered against the upstream
    # Bronze data product is run (mirrors scripts/run_silver_to_gold.py).
    product_id: str | None = None
    reprocess: bool = False


class PipelineRunOut(BaseModel):
    pipeline_run_id: str
    pipeline_name: str
    pipeline_type: str
    organization_id: str
    tenant_id: str
    source_table: str
    target_table: str
    source_exchange_id: str | None
    source_ingestion_id: str | None
    source_pipeline_run_id: str | None
    data_product_id: str | None
    pipeline_version: str
    contract_version: str
    mapping_version: str | None
    source_snapshot_id: str | None
    target_snapshot_id: str | None
    status: str
    input_record_count: int | None
    output_record_count: int | None
    rejected_record_count: int | None
    started_at: datetime
    completed_at: datetime | None
    error_code: str | None
    error_message: str | None
    created_at: datetime


class PipelineOutcomeOut(BaseModel):
    pipeline_run_id: str
    pipeline_type: str
    status: str
    source_table: str | None
    target_table: str | None
    input_record_count: int
    output_record_count: int
    rejected_record_count: int
    error_code: str | None
    error_message: str | None


class QualityResultOut(BaseModel):
    layer: str
    table_name: str
    rule_name: str
    severity: str
    total_count: int
    failed_count: int
    failure_percentage: float
    passed: bool
    evaluated_at: datetime


class LineageEdgeOut(BaseModel):
    source_type: str
    source_identifier: str
    target_type: str
    target_identifier: str
    created_at: datetime


class PipelineRunDetailOut(BaseModel):
    run: PipelineRunOut
    quality_results: list[QualityResultOut]
    lineage_edges: list[LineageEdgeOut]


class DataProductOut(BaseModel):
    data_product_id: str
    display_name: str
    version: str
    gold_table: str
    owner: str
    description: str | None
    status: str
