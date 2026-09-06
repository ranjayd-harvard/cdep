"""Trusted models describing the Exchange <-> Lakehouse handoff contract
(AGENTS.md sections 11-12). These are the only source of organization_id /
tenant_id / source path used by ingestion -- never CLI arguments, never
manifest business-column content.
"""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class ExchangeReady(BaseModel):
    exchange_id: str = Field(alias="exchangeId")
    organization_id: str = Field(alias="organizationId")
    tenant_id: str = Field(alias="tenantId")
    data_product_id: str = Field(alias="dataProductId")
    schema_version: str = Field(alias="schemaVersion")
    direction: str
    status: str

    model_config = {"populate_by_name": True}


class ManifestFile(BaseModel):
    original_filename: str = Field(alias="originalFilename")
    content_type: str | None = Field(default=None, alias="contentType")
    format: str
    size_bytes: int = Field(alias="sizeBytes")
    checksum_algorithm: str | None = Field(default=None, alias="checksumAlgorithm")
    checksum: str | None = None

    model_config = {"populate_by_name": True}


class ManifestExchange(BaseModel):
    exchange_id: str = Field(alias="exchangeId")
    direction: str
    status: str

    model_config = {"populate_by_name": True}


class ManifestOwnership(BaseModel):
    organization_id: str = Field(alias="organizationId")
    tenant_id: str = Field(alias="tenantId")

    model_config = {"populate_by_name": True}


class ManifestSubmittedBy(BaseModel):
    user_id: str | None = Field(default=None, alias="userId")

    model_config = {"populate_by_name": True}


class ManifestDataProduct(BaseModel):
    data_product_id: str = Field(alias="dataProductId")
    schema_version: str = Field(alias="schemaVersion")

    model_config = {"populate_by_name": True}


class ManifestSource(BaseModel):
    channel: str | None = None


class ManifestTimestamps(BaseModel):
    received_at: datetime | None = Field(default=None, alias="receivedAt")

    model_config = {"populate_by_name": True}


class ExchangeManifest(BaseModel):
    manifest_version: str = Field(alias="manifestVersion")
    exchange: ManifestExchange
    ownership: ManifestOwnership
    submitted_by: ManifestSubmittedBy | None = Field(default=None, alias="submittedBy")
    data_product: ManifestDataProduct = Field(alias="dataProduct")
    file: ManifestFile
    source: ManifestSource | None = None
    timestamps: ManifestTimestamps | None = None

    # Where the original object lives in exchange-inbound storage. Populated
    # by the exchange client from trusted exchange-file metadata -- not part
    # of the customer-supplied manifest JSON itself.
    storage_bucket: str | None = None
    storage_key: str | None = None

    model_config = {"populate_by_name": True}
