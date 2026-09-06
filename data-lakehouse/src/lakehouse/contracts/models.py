"""Typed models for Silver contracts (contracts/silver/*.yaml) and Gold Data
Product contracts (contracts/gold/*.yaml). See AGENTS.md sections 10/23.

Kept deliberately separate from `lakehouse.config.models.DataProductContract`
(Bronze's technical ingestion contract) -- Silver/Gold contracts describe
canonical/business shape, not source-format parsing.
"""

from __future__ import annotations

from pydantic import BaseModel, Field


class QualityRuleConfig(BaseModel):
    name: str
    type: str  # not_null | unique | min | max | allowed_values | regex | date_range
    column: str
    value: object | None = None  # threshold/pattern/list, meaning depends on `type`
    severity: str = "ERROR"  # INFO | WARNING | ERROR


class QualityFailureConfig(BaseModel):
    quarantine_invalid_records: bool = Field(default=True, alias="quarantineInvalidRecords")
    fail_pipeline: bool = Field(default=False, alias="failPipeline")

    model_config = {"populate_by_name": True}


class QualityPolicyConfig(BaseModel):
    error_threshold_percent: float = Field(default=0.0, alias="errorThresholdPercent")
    on_failure: QualityFailureConfig = Field(
        default_factory=QualityFailureConfig, alias="onFailure"
    )

    model_config = {"populate_by_name": True}


class DeduplicationConfig(BaseModel):
    # Column used to pick a deterministic "winner" among records sharing the
    # same business key -- the record with the greatest value of this column
    # wins (AGENTS.md section 13: "latest source received timestamp" etc).
    order_by: str = "_source_received_at"
    tiebreaker: str = "_ingested_at"


class IncrementalConfig(BaseModel):
    strategy: str = "UPSERT"  # UPSERT is the only supported strategy in Phase 3


class SilverQuality(BaseModel):
    rules: list[QualityRuleConfig] = Field(default_factory=list)
    policy: QualityPolicyConfig = Field(default_factory=QualityPolicyConfig)


class SilverContract(BaseModel):
    """Parsed form of contracts/silver/<entity>.yaml."""

    entity: str
    version: str
    owner: str
    description: str = ""

    business_key: list[str] = Field(alias="businessKey")

    quality: SilverQuality = Field(default_factory=SilverQuality)
    deduplication: DeduplicationConfig = Field(default_factory=DeduplicationConfig)
    incremental: IncrementalConfig = Field(default_factory=IncrementalConfig)

    model_config = {"populate_by_name": True}


class GoldColumnConfig(BaseModel):
    type: str
    required: bool = False


class GoldSlaConfig(BaseModel):
    freshness_minutes: int = Field(default=1440, alias="freshnessMinutes")

    model_config = {"populate_by_name": True}


class GoldQualityConfig(BaseModel):
    minimum_completeness_percent: float = Field(
        default=95.0, alias="minimumCompletenessPercent"
    )
    rules: list[QualityRuleConfig] = Field(default_factory=list)
    policy: QualityPolicyConfig = Field(default_factory=QualityPolicyConfig)

    model_config = {"populate_by_name": True}


class GoldPublicationConfig(BaseModel):
    formats: list[str] = Field(default_factory=list)


class GoldDataProductInfo(BaseModel):
    id: str
    name: str
    version: str
    owner: str
    description: str = ""


class GoldSourceConfig(BaseModel):
    table: str


class GoldDataProductContract(BaseModel):
    """Parsed form of contracts/gold/<data_product_id>.yaml."""

    data_product: GoldDataProductInfo = Field(alias="dataProduct")
    source: GoldSourceConfig
    grain_description: str = Field(default="", alias="grain")
    keys: list[str]
    schema_: dict[str, GoldColumnConfig] = Field(default_factory=dict, alias="schema")
    sla: GoldSlaConfig = Field(default_factory=GoldSlaConfig)
    quality: GoldQualityConfig = Field(default_factory=GoldQualityConfig)
    publication: GoldPublicationConfig = Field(default_factory=GoldPublicationConfig)

    model_config = {"populate_by_name": True}

    @property
    def data_product_id(self) -> str:
        return self.data_product.id

    @property
    def version(self) -> str:
        return self.data_product.version
