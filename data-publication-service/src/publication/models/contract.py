"""Typed model for a publication contract (contracts/products/*.yaml).
Mirrors the shape documented in AGENTS.md section 7 -- this is the ONLY
place that determines what a customer artifact contains.
"""

from __future__ import annotations

from pydantic import BaseModel, Field


class PublishedColumn(BaseModel):
    name: str
    source: str
    type: str
    required: bool = False


class TenantScope(BaseModel):
    organization_column: str = Field(alias="organizationColumn")
    tenant_column: str = Field(alias="tenantColumn")

    model_config = {"populate_by_name": True}


class CompressionConfig(BaseModel):
    parquet: str = "snappy"
    csv: str = "gzip"


class PublicationSettings(BaseModel):
    filename_pattern: str = Field(alias="filenamePattern")
    compression: CompressionConfig = Field(default_factory=CompressionConfig)
    expiration_hours: int = Field(default=168, alias="expirationHours")

    model_config = {"populate_by_name": True}


class QualityGateConfig(BaseModel):
    verify_schema: bool = Field(default=True, alias="verifySchema")
    verify_record_count: bool = Field(default=True, alias="verifyRecordCount")
    require_non_empty: bool = Field(default=True, alias="requireNonEmpty")
    enforce_grain: bool = Field(default=True, alias="enforceGrain")

    model_config = {"populate_by_name": True}


class MaskingRule(BaseModel):
    strategy: str  # redact | hash


class DataProductInfo(BaseModel):
    id: str
    name: str
    version: str
    owner: str


class SourceConfig(BaseModel):
    table: str


class PublicationContract(BaseModel):
    """Parsed form of contracts/products/<data_product_id>.yaml."""

    data_product: DataProductInfo = Field(alias="dataProduct")
    source: SourceConfig
    grain: list[str]
    tenant_scope: TenantScope = Field(alias="tenantScope")
    published_schema: list[PublishedColumn] = Field(alias="publishedSchema")
    formats: list[str] = Field(default_factory=lambda: ["PARQUET"])
    default_format: str = Field(default="PARQUET", alias="defaultFormat")
    publication: PublicationSettings
    quality: QualityGateConfig = Field(default_factory=QualityGateConfig)
    masking: dict[str, MaskingRule] = Field(default_factory=dict)

    model_config = {"populate_by_name": True}

    @property
    def data_product_id(self) -> str:
        return self.data_product.id

    @property
    def version(self) -> str:
        return self.data_product.version

    @property
    def source_table_name(self) -> str:
        """`gold.event_performance` -> `event_performance`."""
        return self.source.table.split(".", 1)[-1]

    @property
    def required_columns(self) -> list[str]:
        return [c.name for c in self.published_schema if c.required]
