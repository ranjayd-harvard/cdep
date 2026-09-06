"""Ingestion metrics (AGENTS.md section 34).

No metrics backend is wired up yet in Phase 2 -- metrics are emitted as a
single structured log event per ingestion run so they remain queryable
(e.g. via log aggregation) without adding new infrastructure. Swapping to
Prometheus/OTel later means changing only `emit_ingestion_metrics`.
"""

from __future__ import annotations

from dataclasses import dataclass

import structlog

log = structlog.get_logger(__name__)


@dataclass
class IngestionMetrics:
    ingestion_id: str
    exchange_id: str
    organization_id: str
    tenant_id: str
    data_product_id: str
    status: str
    source_record_count: int
    bronze_record_count: int
    rejected_record_count: int
    duration_ms: int
    input_size_bytes: int


def emit_ingestion_metrics(metrics: IngestionMetrics) -> None:
    log.info("ingestion.metrics", **metrics.__dict__)
