"""Reads/writes against api_serving.event_performance_events(_staging) and
api_serving.projection_runs. Raw parameterized SQL, no ORM -- same
discipline as every other service in this monorepo.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
from typing import Any

from sqlalchemy import Connection, text

from serving_projection.common.errors import NoPriorSuccessfulRunError, ProjectionRunNotFoundError

EVENT_COLUMNS = [
    "organization_id",
    "tenant_id",
    "product_version",
    "event_id",
    "venue_id",
    "event_date",
    "tickets_sold",
    "gross_revenue",
    "revenue_per_ticket",
    "source_updated_at",
    "serving_snapshot_id",
    "source_change_token",
    "_gold_pipeline_run_id",
    "_silver_pipeline_run_id",
    "ingestion_id",
    "exchange_id",
    "storage_path",
]


@dataclass
class ServingEventRow:
    organization_id: str
    tenant_id: str
    product_version: str
    event_id: str
    venue_id: str
    event_date: date
    tickets_sold: int | None
    gross_revenue: Any
    revenue_per_ticket: Any
    source_updated_at: datetime
    serving_snapshot_id: str
    source_change_token: str
    gold_pipeline_run_id: str | None
    silver_pipeline_run_id: str | None
    ingestion_id: str | None
    exchange_id: str | None
    storage_path: str | None

    def as_params(self) -> dict[str, Any]:
        return {
            "organization_id": self.organization_id,
            "tenant_id": self.tenant_id,
            "product_version": self.product_version,
            "event_id": self.event_id,
            "venue_id": self.venue_id,
            "event_date": self.event_date,
            "tickets_sold": self.tickets_sold,
            "gross_revenue": self.gross_revenue,
            "revenue_per_ticket": self.revenue_per_ticket,
            "source_updated_at": self.source_updated_at,
            "serving_snapshot_id": self.serving_snapshot_id,
            "source_change_token": self.source_change_token,
            "_gold_pipeline_run_id": self.gold_pipeline_run_id,
            "_silver_pipeline_run_id": self.silver_pipeline_run_id,
            "ingestion_id": self.ingestion_id,
            "exchange_id": self.exchange_id,
            "storage_path": self.storage_path,
        }


_COLUMN_LIST = ", ".join(EVENT_COLUMNS)
_VALUE_LIST = ", ".join(f":{c}" for c in EVENT_COLUMNS)


def truncate_staging(conn: Connection) -> None:
    conn.execute(text("TRUNCATE api_serving.event_performance_events_staging"))


def bulk_insert_staging(conn: Connection, rows: list[ServingEventRow]) -> int:
    if not rows:
        return 0
    conn.execute(
        text(f"INSERT INTO api_serving.event_performance_events_staging ({_COLUMN_LIST}) VALUES ({_VALUE_LIST})"),
        [r.as_params() for r in rows],
    )
    return len(rows)


def staging_row_count(conn: Connection) -> int:
    return conn.execute(text("SELECT count(*) FROM api_serving.event_performance_events_staging")).scalar_one()


# Atomic three-way rename swap (spec §8.4 "atomically publish" / "a failed
# refresh must leave the previous successful serving snapshot available").
# Must run inside a transaction the caller controls (repository functions
# never commit on their own) -- if anything before this call raises, `live`
# is never touched. Note: index names do not get renamed to match (Postgres
# has no "rename all indexes on this table" primitive), so after a swap the
# live table's indexes may carry `_staging`-suffixed names and vice versa --
# cosmetic only, the same three indexes always exist on whichever table is
# live.
def swap_staging_into_live(conn: Connection) -> None:
    conn.execute(text("ALTER TABLE api_serving.event_performance_events RENAME TO event_performance_events_old"))
    conn.execute(text("ALTER TABLE api_serving.event_performance_events_staging RENAME TO event_performance_events"))
    conn.execute(text("ALTER TABLE api_serving.event_performance_events_old RENAME TO event_performance_events_staging"))
    conn.execute(text("TRUNCATE api_serving.event_performance_events_staging"))


def upsert_live(conn: Connection, rows: list[ServingEventRow]) -> int:
    if not rows:
        return 0
    update_assignments = ", ".join(f"{c} = EXCLUDED.{c}" for c in EVENT_COLUMNS if c not in ("organization_id", "tenant_id", "event_id"))
    conn.execute(
        text(
            f"""
            INSERT INTO api_serving.event_performance_events ({_COLUMN_LIST})
            VALUES ({_VALUE_LIST})
            ON CONFLICT (organization_id, tenant_id, event_id)
            DO UPDATE SET {update_assignments}
            """
        ),
        [r.as_params() for r in rows],
    )
    return len(rows)


# ---- projection_runs ------------------------------------------------------


def start_run(
    conn: Connection,
    *,
    projection_run_id: str,
    product_id: str,
    product_version: str,
    refresh_type: str,
    started_at: datetime,
) -> None:
    conn.execute(
        text(
            """
            INSERT INTO api_serving.projection_runs
                (projection_run_id, product_id, product_version, refresh_type, status, started_at)
            VALUES (:id, :product_id, :product_version, :refresh_type, 'RUNNING', :started_at)
            """
        ),
        {
            "id": projection_run_id,
            "product_id": product_id,
            "product_version": product_version,
            "refresh_type": refresh_type,
            "started_at": started_at,
        },
    )


def complete_run(
    conn: Connection,
    *,
    projection_run_id: str,
    source_snapshot: str,
    serving_snapshot_id: str,
    rows_read: int,
    rows_written: int,
    checkpoint: dict[str, Any] | None,
    completed_at: datetime,
) -> None:
    conn.execute(
        text(
            """
            UPDATE api_serving.projection_runs
            SET status = 'SUCCEEDED', source_snapshot = :source_snapshot,
                serving_snapshot_id = :serving_snapshot_id, rows_read = :rows_read,
                rows_written = :rows_written, checkpoint = CAST(:checkpoint AS JSONB), completed_at = :completed_at
            WHERE projection_run_id = :id
            """
        ),
        {
            "id": projection_run_id,
            "source_snapshot": source_snapshot,
            "serving_snapshot_id": serving_snapshot_id,
            "rows_read": rows_read,
            "rows_written": rows_written,
            "checkpoint": _to_json(checkpoint),
            "completed_at": completed_at,
        },
    )


def fail_run(conn: Connection, *, projection_run_id: str, error_code: str, error_message: str, completed_at: datetime) -> None:
    conn.execute(
        text(
            """
            UPDATE api_serving.projection_runs
            SET status = 'FAILED', error_code = :error_code, error_message = :error_message, completed_at = :completed_at
            WHERE projection_run_id = :id
            """
        ),
        {"id": projection_run_id, "error_code": error_code, "error_message": error_message, "completed_at": completed_at},
    )


def latest_successful_run(conn: Connection, *, product_id: str, product_version: str) -> dict[str, Any] | None:
    row = conn.execute(
        text(
            """
            SELECT * FROM api_serving.projection_runs
            WHERE product_id = :product_id AND product_version = :product_version AND status = 'SUCCEEDED'
            ORDER BY completed_at DESC NULLS LAST
            LIMIT 1
            """
        ),
        {"product_id": product_id, "product_version": product_version},
    ).mappings().first()
    return dict(row) if row else None


def require_checkpoint(conn: Connection, *, product_id: str, product_version: str) -> dict[str, Any]:
    run = latest_successful_run(conn, product_id=product_id, product_version=product_version)
    if run is None or not run.get("checkpoint"):
        raise NoPriorSuccessfulRunError(
            f"No prior SUCCEEDED run with a checkpoint for {product_id}@{product_version} -- run a FULL refresh first."
        )
    return run["checkpoint"]


def get_run(conn: Connection, projection_run_id: str) -> dict[str, Any]:
    row = conn.execute(
        text("SELECT * FROM api_serving.projection_runs WHERE projection_run_id = :id"),
        {"id": projection_run_id},
    ).mappings().first()
    if row is None:
        raise ProjectionRunNotFoundError(f"Projection run '{projection_run_id}' was not found.")
    return dict(row)


def list_runs(conn: Connection, *, limit: int = 50) -> list[dict[str, Any]]:
    rows = conn.execute(
        text("SELECT * FROM api_serving.projection_runs ORDER BY started_at DESC LIMIT :limit"),
        {"limit": limit},
    ).mappings().all()
    return [dict(r) for r in rows]


def _to_json(value: dict[str, Any] | None) -> str | None:
    import json

    return json.dumps(value) if value is not None else None
