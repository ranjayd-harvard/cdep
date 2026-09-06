"""Operational pipeline metadata store (AGENTS.md sections 5/6).

Backed by PostgreSQL, schema `lakehouse`, tables `pipeline_runs` /
`pipeline_events` -- see sql/002_pipeline_metadata.sql. Mirrors
`lakehouse.ingestion.ingestion_repository.IngestionRepository`'s shape
deliberately, so Bronze->Silver/Silver->Gold pipeline metadata behaves the
same way operationally as Phase 2 ingestion metadata.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime

import sqlalchemy as sa
from sqlalchemy import Engine

from lakehouse.common.time import utcnow
from lakehouse.pipelines.pipeline_status import PipelineStatus, PipelineType


@dataclass
class PipelineRun:
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
    updated_at: datetime


class PipelineRepository:
    def __init__(self, engine: Engine) -> None:
        self._engine = engine

    def create_run(
        self,
        *,
        pipeline_run_id: str,
        pipeline_name: str,
        pipeline_type: PipelineType,
        organization_id: str,
        tenant_id: str,
        source_table: str,
        target_table: str,
        source_exchange_id: str | None,
        source_ingestion_id: str | None,
        source_pipeline_run_id: str | None,
        data_product_id: str | None,
        pipeline_version: str,
        contract_version: str,
        mapping_version: str | None,
        source_snapshot_id: str | None,
        started_at: datetime,
    ) -> None:
        with self._engine.begin() as conn:
            conn.execute(
                sa.text(
                    """
                    INSERT INTO lakehouse.pipeline_runs (
                        pipeline_run_id, pipeline_name, pipeline_type,
                        organization_id, tenant_id,
                        source_table, target_table,
                        source_exchange_id, source_ingestion_id, source_pipeline_run_id,
                        data_product_id,
                        pipeline_version, contract_version, mapping_version,
                        source_snapshot_id,
                        status, started_at, created_at, updated_at
                    ) VALUES (
                        :pipeline_run_id, :pipeline_name, :pipeline_type,
                        :organization_id, :tenant_id,
                        :source_table, :target_table,
                        :source_exchange_id, :source_ingestion_id, :source_pipeline_run_id,
                        :data_product_id,
                        :pipeline_version, :contract_version, :mapping_version,
                        :source_snapshot_id,
                        :status, :started_at, :now, :now
                    )
                    """
                ),
                {
                    "pipeline_run_id": pipeline_run_id,
                    "pipeline_name": pipeline_name,
                    "pipeline_type": pipeline_type.value,
                    "organization_id": organization_id,
                    "tenant_id": tenant_id,
                    "source_table": source_table,
                    "target_table": target_table,
                    "source_exchange_id": source_exchange_id,
                    "source_ingestion_id": source_ingestion_id,
                    "source_pipeline_run_id": source_pipeline_run_id,
                    "data_product_id": data_product_id,
                    "pipeline_version": pipeline_version,
                    "contract_version": contract_version,
                    "mapping_version": mapping_version,
                    "source_snapshot_id": source_snapshot_id,
                    "status": PipelineStatus.CREATED.value,
                    "started_at": started_at,
                    "now": utcnow(),
                },
            )
        self.record_event(pipeline_run_id, "PIPELINE_CREATED", {"pipeline_name": pipeline_name})

    def update_status(self, pipeline_run_id: str, status: PipelineStatus) -> None:
        with self._engine.begin() as conn:
            conn.execute(
                sa.text(
                    "UPDATE lakehouse.pipeline_runs SET status = :status, updated_at = :now "
                    "WHERE pipeline_run_id = :id"
                ),
                {"status": status.value, "now": utcnow(), "id": pipeline_run_id},
            )

    def mark_completed(
        self,
        pipeline_run_id: str,
        *,
        input_record_count: int,
        output_record_count: int,
        rejected_record_count: int,
        target_snapshot_id: str | None,
    ) -> None:
        with self._engine.begin() as conn:
            conn.execute(
                sa.text(
                    """
                    UPDATE lakehouse.pipeline_runs
                    SET status = :status, completed_at = :now, updated_at = :now,
                        input_record_count = :input_count,
                        output_record_count = :output_count,
                        rejected_record_count = :rejected_count,
                        target_snapshot_id = :target_snapshot_id
                    WHERE pipeline_run_id = :id
                    """
                ),
                {
                    "status": PipelineStatus.COMPLETED.value,
                    "now": utcnow(),
                    "input_count": input_record_count,
                    "output_count": output_record_count,
                    "rejected_count": rejected_record_count,
                    "target_snapshot_id": target_snapshot_id,
                    "id": pipeline_run_id,
                },
            )
        self.record_event(
            pipeline_run_id,
            "PIPELINE_COMPLETED",
            {
                "output_record_count": output_record_count,
                "rejected_record_count": rejected_record_count,
            },
        )

    def mark_failed(self, pipeline_run_id: str, *, error_code: str, error_message: str) -> None:
        with self._engine.begin() as conn:
            conn.execute(
                sa.text(
                    """
                    UPDATE lakehouse.pipeline_runs
                    SET status = :status, completed_at = :now, updated_at = :now,
                        error_code = :error_code, error_message = :error_message
                    WHERE pipeline_run_id = :id
                    """
                ),
                {
                    "status": PipelineStatus.FAILED.value,
                    "now": utcnow(),
                    "error_code": error_code,
                    "error_message": error_message[:2000],
                    "id": pipeline_run_id,
                },
            )
        self.record_event(
            pipeline_run_id, "PIPELINE_FAILED", {"error_code": error_code, "error_message": error_message}
        )

    def record_event(self, pipeline_run_id: str, event_type: str, event_data: dict | None = None) -> None:
        with self._engine.begin() as conn:
            conn.execute(
                sa.text(
                    """
                    INSERT INTO lakehouse.pipeline_events (pipeline_run_id, event_type, event_data, occurred_at)
                    VALUES (:pipeline_run_id, :event_type, :event_data, :now)
                    """
                ),
                {
                    "pipeline_run_id": pipeline_run_id,
                    "event_type": event_type,
                    "event_data": json.dumps(event_data or {}, default=str),
                    "now": utcnow(),
                },
            )

    def find_successful_run(
        self,
        *,
        pipeline_name: str,
        organization_id: str,
        tenant_id: str,
        source_ingestion_id: str | None,
        source_pipeline_run_id: str | None,
        pipeline_version: str,
        contract_version: str,
        mapping_version: str | None,
    ) -> PipelineRun | None:
        """Idempotency lookup (AGENTS.md section 40): same pipeline, same
        tenant, same upstream source, same pipeline/contract/mapping
        versions -> already processed, do not duplicate."""
        with self._engine.connect() as conn:
            row = conn.execute(
                sa.text(
                    """
                    SELECT * FROM lakehouse.pipeline_runs
                    WHERE pipeline_name = :pipeline_name
                      AND organization_id = :organization_id
                      AND tenant_id = :tenant_id
                      AND source_ingestion_id IS NOT DISTINCT FROM :source_ingestion_id
                      AND source_pipeline_run_id IS NOT DISTINCT FROM :source_pipeline_run_id
                      AND pipeline_version = :pipeline_version
                      AND contract_version = :contract_version
                      AND mapping_version IS NOT DISTINCT FROM :mapping_version
                      AND status = :status
                    ORDER BY created_at DESC
                    LIMIT 1
                    """
                ),
                {
                    "pipeline_name": pipeline_name,
                    "organization_id": organization_id,
                    "tenant_id": tenant_id,
                    "source_ingestion_id": source_ingestion_id,
                    "source_pipeline_run_id": source_pipeline_run_id,
                    "pipeline_version": pipeline_version,
                    "contract_version": contract_version,
                    "mapping_version": mapping_version,
                    "status": PipelineStatus.COMPLETED.value,
                },
            ).mappings().first()
        return PipelineRun(**dict(row)) if row else None

    def get(self, pipeline_run_id: str) -> PipelineRun | None:
        with self._engine.connect() as conn:
            row = (
                conn.execute(
                    sa.text("SELECT * FROM lakehouse.pipeline_runs WHERE pipeline_run_id = :id"),
                    {"id": pipeline_run_id},
                )
                .mappings()
                .first()
            )
        return PipelineRun(**dict(row)) if row else None

    def list_by_source_ingestion(self, source_ingestion_id: str) -> list[PipelineRun]:
        with self._engine.connect() as conn:
            rows = (
                conn.execute(
                    sa.text(
                        "SELECT * FROM lakehouse.pipeline_runs WHERE source_ingestion_id = :id "
                        "ORDER BY created_at ASC"
                    ),
                    {"id": source_ingestion_id},
                )
                .mappings()
                .all()
            )
        return [PipelineRun(**dict(r)) for r in rows]

    def list_by_source_pipeline_run(self, source_pipeline_run_id: str) -> list[PipelineRun]:
        with self._engine.connect() as conn:
            rows = (
                conn.execute(
                    sa.text(
                        "SELECT * FROM lakehouse.pipeline_runs WHERE source_pipeline_run_id = :id "
                        "ORDER BY created_at ASC"
                    ),
                    {"id": source_pipeline_run_id},
                )
                .mappings()
                .all()
            )
        return [PipelineRun(**dict(r)) for r in rows]

    def list_non_terminal(self) -> list[PipelineRun]:
        with self._engine.connect() as conn:
            rows = (
                conn.execute(
                    sa.text(
                        "SELECT * FROM lakehouse.pipeline_runs "
                        "WHERE status NOT IN (:completed, :failed, :skipped)"
                    ),
                    {
                        "completed": PipelineStatus.COMPLETED.value,
                        "failed": PipelineStatus.FAILED.value,
                        "skipped": PipelineStatus.SKIPPED_DUPLICATE.value,
                    },
                )
                .mappings()
                .all()
            )
        return [PipelineRun(**dict(r)) for r in rows]

    def list_recent(self, limit: int = 50) -> list[PipelineRun]:
        with self._engine.connect() as conn:
            rows = (
                conn.execute(
                    sa.text(
                        "SELECT * FROM lakehouse.pipeline_runs ORDER BY created_at DESC LIMIT :limit"
                    ),
                    {"limit": limit},
                )
                .mappings()
                .all()
            )
        return [PipelineRun(**dict(r)) for r in rows]
