"""IngestionContext (AGENTS.md section 13).

Built exclusively from trusted Exchange/manifest information. Nothing here
is ever constructed from CLI arguments or manifest business-column content
(AGENTS.md sections 9/52).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from lakehouse.common.time import utcnow
from lakehouse.exchange.models import ExchangeManifest, ExchangeReady


@dataclass(frozen=True)
class IngestionContext:
    ingestion_id: str
    exchange_id: str

    organization_id: str
    tenant_id: str

    data_product_id: str
    schema_version: str

    source_file: str
    source_path: str  # storage-relative path, e.g. "bucket/key"
    source_bucket: str
    source_key: str
    source_format: str
    source_checksum: str | None

    received_at: datetime | None
    ingestion_started_at: datetime

    @classmethod
    def create(
        cls,
        *,
        ingestion_id: str,
        exchange: ExchangeReady,
        manifest: ExchangeManifest,
    ) -> IngestionContext:
        assert manifest.storage_bucket and manifest.storage_key, (
            "manifest must be resolved with storage_bucket/storage_key before "
            "an IngestionContext can be created"
        )
        return cls(
            ingestion_id=ingestion_id,
            exchange_id=exchange.exchange_id,
            organization_id=exchange.organization_id,
            tenant_id=exchange.tenant_id,
            data_product_id=exchange.data_product_id,
            schema_version=exchange.schema_version,
            source_file=manifest.file.original_filename,
            source_path=f"{manifest.storage_bucket}/{manifest.storage_key}",
            source_bucket=manifest.storage_bucket,
            source_key=manifest.storage_key,
            source_format=manifest.file.format,
            source_checksum=manifest.file.checksum,
            received_at=manifest.timestamps.received_at if manifest.timestamps else None,
            ingestion_started_at=utcnow(),
        )
