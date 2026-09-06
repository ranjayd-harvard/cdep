"""Quarantine mechanism for technically-unreadable records (AGENTS.md
section 24). Rejected records are never silently discarded -- they are
written as JSONL alongside enough context to reprocess or inspect them,
under lakehouse-bronze/rejects/{data_product_id}/{ingestion_id}/.
"""

from __future__ import annotations

import json

import structlog

from lakehouse.common.time import utcnow
from lakehouse.ingestion.ingestion_context import IngestionContext
from lakehouse.readers.interface import RawRecord
from lakehouse.storage.interface import StorageClient
from lakehouse.storage.path_builder import reject_key

log = structlog.get_logger(__name__)


def write_rejects(
    storage: StorageClient,
    *,
    bucket: str,
    context: IngestionContext,
    rejected: list[RawRecord],
) -> str | None:
    if not rejected:
        return None

    lines = []
    rejected_at = utcnow().isoformat()
    for r in rejected:
        lines.append(
            json.dumps(
                {
                    "organization_id": context.organization_id,
                    "tenant_id": context.tenant_id,
                    "exchange_id": context.exchange_id,
                    "ingestion_id": context.ingestion_id,
                    "source_file": context.source_file,
                    "source_row": r.row_number,
                    "raw_payload": r.data,
                    "error_code": "SOURCE_UNREADABLE",
                    "error_message": r.error,
                    "rejected_at": rejected_at,
                }
            )
        )

    key = reject_key(context.data_product_id, context.ingestion_id)
    storage.put_bytes(bucket, key, ("\n".join(lines) + "\n").encode("utf-8"), "application/x-ndjson")
    log.info(
        "ingestion.rejects.written",
        ingestion_id=context.ingestion_id,
        exchange_id=context.exchange_id,
        rejected_count=len(rejected),
        path=f"{bucket}/{key}",
    )
    return f"{bucket}/{key}"
