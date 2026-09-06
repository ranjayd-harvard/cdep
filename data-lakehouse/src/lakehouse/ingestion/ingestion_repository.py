"""Operational ingestion metadata store (AGENTS.md section 15).

Backed by PostgreSQL, schema `lakehouse`, table `ingestion_runs` -- see
sql/001_ingestion_runs.sql for DDL. Deliberately separate from the Iceberg
catalog's own metadata tables (schema `iceberg_catalog`).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from functools import lru_cache

import sqlalchemy as sa
from sqlalchemy import Engine

from lakehouse.common.time import utcnow
from lakehouse.config.settings import Settings, get_settings
from lakehouse.ingestion.status import IngestionStatus


@dataclass
class IngestionRun:
    ingestion_id: str
    exchange_id: str
    organization_id: str
    tenant_id: str
    data_product_id: str
    schema_version: str
    source_filename: str
    source_format: str
    source_checksum: str | None
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
    updated_at: datetime


@lru_cache
def get_engine() -> Engine:
    return build_engine(get_settings())


def build_engine(settings: Settings) -> Engine:
    return sa.create_engine(settings.metadata_db_url, future=True)


class IngestionRepository:
    def __init__(self, engine: Engine | None = None) -> None:
        self._engine = engine or get_engine()

    def create_run(
        self,
        *,
        ingestion_id: str,
        exchange_id: str,
        organization_id: str,
        tenant_id: str,
        data_product_id: str,
        schema_version: str,
        source_filename: str,
        source_format: str,
        source_checksum: str | None,
        bronze_table: str,
        started_at: datetime,
    ) -> None:
        with self._engine.begin() as conn:
            conn.execute(
                sa.text(
                    """
                    INSERT INTO lakehouse.ingestion_runs (
                        ingestion_id, exchange_id, organization_id, tenant_id,
                        data_product_id, schema_version, source_filename,
                        source_format, source_checksum, bronze_table, status,
                        started_at, created_at, updated_at
                    ) VALUES (
                        :ingestion_id, :exchange_id, :organization_id, :tenant_id,
                        :data_product_id, :schema_version, :source_filename,
                        :source_format, :source_checksum, :bronze_table, :status,
                        :started_at, :now, :now
                    )
                    """
                ),
                {
                    "ingestion_id": ingestion_id,
                    "exchange_id": exchange_id,
                    "organization_id": organization_id,
                    "tenant_id": tenant_id,
                    "data_product_id": data_product_id,
                    "schema_version": schema_version,
                    "source_filename": source_filename,
                    "source_format": source_format,
                    "source_checksum": source_checksum,
                    "bronze_table": bronze_table,
                    "status": IngestionStatus.CREATED.value,
                    "started_at": started_at,
                    "now": utcnow(),
                },
            )

    def update_status(self, ingestion_id: str, status: IngestionStatus) -> None:
        with self._engine.begin() as conn:
            conn.execute(
                sa.text(
                    "UPDATE lakehouse.ingestion_runs SET status = :status, updated_at = :now "
                    "WHERE ingestion_id = :ingestion_id"
                ),
                {"status": status.value, "now": utcnow(), "ingestion_id": ingestion_id},
            )

    def mark_completed(
        self,
        ingestion_id: str,
        *,
        source_record_count: int,
        bronze_record_count: int,
        rejected_record_count: int,
    ) -> None:
        with self._engine.begin() as conn:
            conn.execute(
                sa.text(
                    """
                    UPDATE lakehouse.ingestion_runs
                    SET status = :status, completed_at = :now, updated_at = :now,
                        source_record_count = :src, bronze_record_count = :bronze,
                        rejected_record_count = :rejected
                    WHERE ingestion_id = :ingestion_id
                    """
                ),
                {
                    "status": IngestionStatus.COMPLETED.value,
                    "now": utcnow(),
                    "src": source_record_count,
                    "bronze": bronze_record_count,
                    "rejected": rejected_record_count,
                    "ingestion_id": ingestion_id,
                },
            )

    def mark_failed(self, ingestion_id: str, *, error_code: str, error_message: str) -> None:
        with self._engine.begin() as conn:
            conn.execute(
                sa.text(
                    """
                    UPDATE lakehouse.ingestion_runs
                    SET status = :status, completed_at = :now, updated_at = :now,
                        error_code = :error_code, error_message = :error_message
                    WHERE ingestion_id = :ingestion_id
                    """
                ),
                {
                    "status": IngestionStatus.FAILED.value,
                    "now": utcnow(),
                    "error_code": error_code,
                    "error_message": error_message[:2000],
                    "ingestion_id": ingestion_id,
                },
            )

    def find_successful_run(
        self, *, exchange_id: str, data_product_id: str, schema_version: str
    ) -> IngestionRun | None:
        with self._engine.connect() as conn:
            row = conn.execute(
                sa.text(
                    """
                    SELECT * FROM lakehouse.ingestion_runs
                    WHERE exchange_id = :exchange_id
                      AND data_product_id = :data_product_id
                      AND schema_version = :schema_version
                      AND status = :status
                    ORDER BY created_at DESC
                    LIMIT 1
                    """
                ),
                {
                    "exchange_id": exchange_id,
                    "data_product_id": data_product_id,
                    "schema_version": schema_version,
                    "status": IngestionStatus.COMPLETED.value,
                },
            ).mappings().first()
        return IngestionRun(**dict(row)) if row else None

    def get(self, ingestion_id: str) -> IngestionRun | None:
        with self._engine.connect() as conn:
            row = (
                conn.execute(
                    sa.text(
                        "SELECT * FROM lakehouse.ingestion_runs WHERE ingestion_id = :id"
                    ),
                    {"id": ingestion_id},
                )
                .mappings()
                .first()
            )
        return IngestionRun(**dict(row)) if row else None

    def list_by_exchange(self, exchange_id: str) -> list[IngestionRun]:
        with self._engine.connect() as conn:
            rows = (
                conn.execute(
                    sa.text(
                        "SELECT * FROM lakehouse.ingestion_runs WHERE exchange_id = :id "
                        "ORDER BY created_at ASC"
                    ),
                    {"id": exchange_id},
                )
                .mappings()
                .all()
            )
        return [IngestionRun(**dict(r)) for r in rows]

    def list_recent(self, limit: int = 50) -> list[IngestionRun]:
        with self._engine.connect() as conn:
            rows = (
                conn.execute(
                    sa.text(
                        "SELECT * FROM lakehouse.ingestion_runs ORDER BY created_at DESC LIMIT :limit"
                    ),
                    {"limit": limit},
                )
                .mappings()
                .all()
            )
        return [IngestionRun(**dict(r)) for r in rows]

    def list_non_terminal(self) -> list[IngestionRun]:
        with self._engine.connect() as conn:
            rows = (
                conn.execute(
                    sa.text(
                        "SELECT * FROM lakehouse.ingestion_runs "
                        "WHERE status NOT IN (:completed, :failed, :skipped)"
                    ),
                    {
                        "completed": IngestionStatus.COMPLETED.value,
                        "failed": IngestionStatus.FAILED.value,
                        "skipped": IngestionStatus.SKIPPED_DUPLICATE.value,
                    },
                )
                .mappings()
                .all()
            )
        return [IngestionRun(**dict(r)) for r in rows]
