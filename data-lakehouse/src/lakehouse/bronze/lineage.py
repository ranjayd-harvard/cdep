"""Attaches technical lineage metadata to raw source records.

Bronze philosophy (AGENTS.md section 17): business columns are passed
through untouched. Everything in this module only *adds* the `_`-prefixed
technical columns; it never renames or transforms a source field.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from lakehouse.bronze.metadata_columns import SOURCE_SYSTEM
from lakehouse.common.utils import stable_record_hash
from lakehouse.exchange.models import ExchangeManifest
from lakehouse.ingestion.ingestion_context import IngestionContext


def attach_lineage(
    business_record: dict[str, Any],
    *,
    context: IngestionContext,
    manifest: ExchangeManifest,
    row_number: int,
    ingested_at: datetime,
) -> dict[str, Any]:
    record = dict(business_record)
    record.update(
        {
            "_organization_id": context.organization_id,
            "_tenant_id": context.tenant_id,
            "_exchange_id": context.exchange_id,
            "_ingestion_id": context.ingestion_id,
            "_data_product_id": context.data_product_id,
            "_schema_version": context.schema_version,
            "_source_file": context.source_file,
            "_source_path": context.source_path,
            "_source_format": context.source_format,
            "_source_received_at": context.received_at,
            "_ingested_at": ingested_at,
            "_source_row_number": row_number,
            "_record_hash": stable_record_hash(business_record),
            "_source_system": SOURCE_SYSTEM,
            "_source_channel": manifest.source.channel if manifest.source else None,
        }
    )
    return record
