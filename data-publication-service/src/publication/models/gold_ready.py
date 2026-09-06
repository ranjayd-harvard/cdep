"""GoldReady input model (AGENTS.md section 6).

Values carried here are trusted internal pipeline metadata -- they are
never re-derived from a customer request. They ARE still validated for
internal consistency (contract exists, snapshot exists, tenant scope
non-empty) before publication proceeds -- see
`services.publication_service.PublicationService._validate_gold_ready`.
"""

from __future__ import annotations

from pydantic import BaseModel, Field


class GoldReadyContext(BaseModel):
    pipeline_run_id: str = Field(alias="pipelineRunId")
    organization_id: str = Field(alias="organizationId")
    tenant_id: str = Field(alias="tenantId")

    data_product_id: str = Field(alias="dataProductId")
    product_version: str = Field(alias="productVersion")

    gold_table: str = Field(alias="goldTable")
    gold_snapshot_id: str | None = Field(default=None, alias="goldSnapshotId")

    record_count: int = Field(alias="recordCount")

    model_config = {"populate_by_name": True}
