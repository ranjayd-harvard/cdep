"""Publication control-plane repository (AGENTS.md sections 13/14/15/52).

Backed by PostgreSQL, schema `publication`, tables `publication_runs` /
`publication_artifacts` / `publication_events` / `publication_quality_results`.
Deliberately mirrors data-lakehouse's `PipelineRepository` shape.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime

import sqlalchemy as sa
from sqlalchemy import Engine

from publication.common.time import utcnow
from publication.quality.results import QualityRuleResult


@dataclass
class PublicationRunRow:
    publication_id: str
    organization_id: str
    tenant_id: str
    data_product_id: str
    product_version: str
    source_gold_table: str
    source_gold_snapshot_id: str | None
    source_pipeline_run_id: str | None
    requested_format: str | None
    contract_version: str | None
    schema_fingerprint: str | None
    status: str
    input_record_count: int | None
    output_record_count: int | None
    artifact_count: int | None
    outbound_exchange_id: str | None
    idempotency_key: str | None
    started_at: datetime | None
    completed_at: datetime | None
    error_code: str | None
    error_message: str | None
    created_at: datetime
    updated_at: datetime


class PublicationRepository:
    def __init__(self, engine: Engine) -> None:
        self._engine = engine

    def create_run(
        self,
        *,
        publication_id: str,
        organization_id: str,
        tenant_id: str,
        data_product_id: str,
        product_version: str,
        source_gold_table: str,
        source_gold_snapshot_id: str | None,
        source_pipeline_run_id: str | None,
        requested_format: str,
        contract_version: str,
        idempotency_key: str,
        started_at: datetime,
    ) -> None:
        with self._engine.begin() as conn:
            conn.execute(
                sa.text(
                    """
                    INSERT INTO publication.publication_runs (
                        publication_id, organization_id, tenant_id,
                        data_product_id, product_version,
                        source_gold_table, source_gold_snapshot_id, source_pipeline_run_id,
                        requested_format, contract_version, idempotency_key,
                        status, started_at, created_at, updated_at
                    ) VALUES (
                        :publication_id, :organization_id, :tenant_id,
                        :data_product_id, :product_version,
                        :source_gold_table, :source_gold_snapshot_id, :source_pipeline_run_id,
                        :requested_format, :contract_version, :idempotency_key,
                        :status, :started_at, :now, :now
                    )
                    """
                ),
                {
                    "publication_id": publication_id,
                    "organization_id": organization_id,
                    "tenant_id": tenant_id,
                    "data_product_id": data_product_id,
                    "product_version": product_version,
                    "source_gold_table": source_gold_table,
                    "source_gold_snapshot_id": source_gold_snapshot_id,
                    "source_pipeline_run_id": source_pipeline_run_id,
                    "requested_format": requested_format,
                    "contract_version": contract_version,
                    "idempotency_key": idempotency_key,
                    "status": "CREATED",
                    "started_at": started_at,
                    "now": utcnow(),
                },
            )
        self.record_event(publication_id, "PUBLICATION_CREATED", {"data_product_id": data_product_id})

    def update_status(self, publication_id: str, status: str) -> None:
        with self._engine.begin() as conn:
            conn.execute(
                sa.text(
                    "UPDATE publication.publication_runs SET status = :status, updated_at = :now WHERE publication_id = :id"
                ),
                {"status": status, "now": utcnow(), "id": publication_id},
            )

    def set_schema_fingerprint(self, publication_id: str, fingerprint: str) -> None:
        with self._engine.begin() as conn:
            conn.execute(
                sa.text(
                    "UPDATE publication.publication_runs SET schema_fingerprint = :fp, updated_at = :now WHERE publication_id = :id"
                ),
                {"fp": fingerprint, "now": utcnow(), "id": publication_id},
            )

    def mark_ready(
        self,
        publication_id: str,
        *,
        input_record_count: int,
        output_record_count: int,
        artifact_count: int,
        outbound_exchange_id: str,
    ) -> None:
        with self._engine.begin() as conn:
            conn.execute(
                sa.text(
                    """
                    UPDATE publication.publication_runs
                    SET status = 'READY', completed_at = :now, updated_at = :now,
                        input_record_count = :input_count, output_record_count = :output_count,
                        artifact_count = :artifact_count, outbound_exchange_id = :exchange_id
                    WHERE publication_id = :id
                    """
                ),
                {
                    "now": utcnow(),
                    "input_count": input_record_count,
                    "output_count": output_record_count,
                    "artifact_count": artifact_count,
                    "exchange_id": outbound_exchange_id,
                    "id": publication_id,
                },
            )
        self.record_event(
            publication_id,
            "PUBLICATION_READY",
            {"output_record_count": output_record_count, "outbound_exchange_id": outbound_exchange_id},
        )

    def set_outbound_exchange_id(self, publication_id: str, outbound_exchange_id: str) -> None:
        with self._engine.begin() as conn:
            conn.execute(
                sa.text(
                    "UPDATE publication.publication_runs SET outbound_exchange_id = :exchange_id, updated_at = :now "
                    "WHERE publication_id = :id"
                ),
                {"exchange_id": outbound_exchange_id, "now": utcnow(), "id": publication_id},
            )

    def mark_failed(self, publication_id: str, *, error_code: str, error_message: str) -> None:
        with self._engine.begin() as conn:
            conn.execute(
                sa.text(
                    """
                    UPDATE publication.publication_runs
                    SET status = 'FAILED', completed_at = :now, updated_at = :now,
                        error_code = :error_code, error_message = :error_message
                    WHERE publication_id = :id
                    """
                ),
                {"now": utcnow(), "error_code": error_code, "error_message": error_message[:2000], "id": publication_id},
            )
        self.record_event(publication_id, "PUBLICATION_FAILED", {"error_code": error_code, "error_message": error_message})

    def record_event(self, publication_id: str, event_type: str, event_data: dict | None = None) -> None:
        with self._engine.begin() as conn:
            conn.execute(
                sa.text(
                    """
                    INSERT INTO publication.publication_events (publication_id, event_type, event_data, occurred_at)
                    VALUES (:publication_id, :event_type, :event_data, :now)
                    """
                ),
                {
                    "publication_id": publication_id,
                    "event_type": event_type,
                    "event_data": json.dumps(event_data or {}, default=str),
                    "now": utcnow(),
                },
            )

    def record_artifact(
        self,
        *,
        artifact_id: str,
        publication_id: str,
        filename: str,
        format: str,
        content_type: str | None,
        compression: str | None,
        size_bytes: int,
        checksum_algorithm: str,
        checksum: str,
        record_count: int,
        outbound_exchange_id: str | None,
    ) -> None:
        with self._engine.begin() as conn:
            conn.execute(
                sa.text(
                    """
                    INSERT INTO publication.publication_artifacts (
                        artifact_id, publication_id, filename, format, content_type, compression,
                        size_bytes, checksum_algorithm, checksum, record_count, outbound_exchange_id, created_at
                    ) VALUES (
                        :artifact_id, :publication_id, :filename, :format, :content_type, :compression,
                        :size_bytes, :checksum_algorithm, :checksum, :record_count, :outbound_exchange_id, :now
                    )
                    """
                ),
                {
                    "artifact_id": artifact_id,
                    "publication_id": publication_id,
                    "filename": filename,
                    "format": format,
                    "content_type": content_type,
                    "compression": compression,
                    "size_bytes": size_bytes,
                    "checksum_algorithm": checksum_algorithm,
                    "checksum": checksum,
                    "record_count": record_count,
                    "outbound_exchange_id": outbound_exchange_id,
                    "now": utcnow(),
                },
            )

    def record_quality_results(self, publication_id: str, results: list[QualityRuleResult]) -> None:
        with self._engine.begin() as conn:
            for r in results:
                conn.execute(
                    sa.text(
                        """
                        INSERT INTO publication.publication_quality_results (
                            publication_id, rule_name, severity, total_count, failed_count, passed, evaluated_at
                        ) VALUES (:publication_id, :rule_name, :severity, :total_count, :failed_count, :passed, :now)
                        """
                    ),
                    {
                        "publication_id": publication_id,
                        "rule_name": r.rule_name,
                        "severity": r.severity,
                        "total_count": r.total_count,
                        "failed_count": r.failed_count,
                        "passed": r.passed,
                        "now": utcnow(),
                    },
                )

    def find_by_idempotency_key(self, idempotency_key: str) -> PublicationRunRow | None:
        with self._engine.connect() as conn:
            row = conn.execute(
                sa.text(
                    "SELECT * FROM publication.publication_runs WHERE idempotency_key = :key AND status = 'READY' "
                    "ORDER BY created_at DESC LIMIT 1"
                ),
                {"key": idempotency_key},
            ).mappings().first()
        return PublicationRunRow(**dict(row)) if row else None

    def get(self, publication_id: str) -> PublicationRunRow | None:
        with self._engine.connect() as conn:
            row = conn.execute(
                sa.text("SELECT * FROM publication.publication_runs WHERE publication_id = :id"),
                {"id": publication_id},
            ).mappings().first()
        return PublicationRunRow(**dict(row)) if row else None

    def list_non_terminal(self) -> list[PublicationRunRow]:
        with self._engine.connect() as conn:
            rows = conn.execute(
                sa.text(
                    "SELECT * FROM publication.publication_runs WHERE status NOT IN "
                    "('READY', 'FAILED', 'EXPIRED', 'SKIPPED_DUPLICATE')"
                )
            ).mappings().all()
        return [PublicationRunRow(**dict(r)) for r in rows]

    def list_recent(self, limit: int = 50) -> list[PublicationRunRow]:
        with self._engine.connect() as conn:
            rows = conn.execute(
                sa.text("SELECT * FROM publication.publication_runs ORDER BY created_at DESC LIMIT :limit"),
                {"limit": limit},
            ).mappings().all()
        return [PublicationRunRow(**dict(r)) for r in rows]

    def list_artifacts(self, publication_id: str) -> list[dict]:
        with self._engine.connect() as conn:
            rows = conn.execute(
                sa.text(
                    "SELECT * FROM publication.publication_artifacts WHERE publication_id = :id ORDER BY created_at"
                ),
                {"id": publication_id},
            ).mappings().all()
        return [dict(r) for r in rows]

    def list_quality_results(self, publication_id: str) -> list[dict]:
        with self._engine.connect() as conn:
            rows = conn.execute(
                sa.text(
                    "SELECT * FROM publication.publication_quality_results WHERE publication_id = :id "
                    "ORDER BY evaluated_at"
                ),
                {"id": publication_id},
            ).mappings().all()
        return [dict(r) for r in rows]
