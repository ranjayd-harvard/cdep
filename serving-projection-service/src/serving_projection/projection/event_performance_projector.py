"""Orchestrates one Gold -> Serving refresh for event-performance (spec §8.4):

    read Gold snapshot -> project serving fields -> load staging ->
    validate -> atomically publish            (FULL)

    read checkpoint -> read changed rows -> UPSERT by tenant+business key ->
    commit -> advance checkpoint                (INCREMENTAL)

A failed FULL refresh never touches the live table (see
serving_store.repository.swap_staging_into_live, only called after staging
is fully loaded and validated, inside the same transaction). A failed
INCREMENTAL refresh rolls back its single transaction, leaving the prior
checkpoint and all previously-upserted rows untouched.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from pyiceberg.catalog import Catalog
from sqlalchemy import Engine

from serving_projection.common.errors import ProjectionValidationError
from serving_projection.common.ids import new_projection_run_id
from serving_projection.lakehouse.gold_bulk_reader import BulkGoldRead, read_full, read_incremental
from serving_projection.projection.checkpoint import TimestampCheckpoint, epoch_checkpoint
from serving_projection.serving_store import repository as store

PRODUCT_ID = "event-performance"
GOLD_TABLE_NAME = "event_performance"


@dataclass
class ProjectionOutcome:
    projection_run_id: str
    status: str
    rows_read: int
    rows_written: int
    serving_snapshot_id: str | None


def _naive_utc(value: datetime) -> datetime:
    """Gold's `_updated_at` is PyIceberg `timestamp("us")` -- no timezone.
    Iceberg scan predicates must be built against naive datetimes to match
    the column's physical type."""
    if value.tzinfo is not None:
        return value.astimezone(timezone.utc).replace(tzinfo=None)
    return value


def _aware_utc(value: datetime) -> datetime:
    """Our own bookkeeping (checkpoints, projection_runs timestamps) always
    stores timezone-aware UTC, regardless of what Gold's raw column carries."""
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _source_change_token(row: dict[str, Any]) -> str:
    fingerprint = "|".join(
        str(row.get(field)) for field in ("venue_id", "event_date", "tickets_sold", "gross_revenue", "revenue_per_ticket")
    )
    return hashlib.sha256(fingerprint.encode("utf-8")).hexdigest()


def _to_serving_row(row: dict[str, Any], *, serving_snapshot_id: str) -> store.ServingEventRow:
    organization_id = row["organization_id"]
    tenant_id = row["tenant_id"]
    event_id = row["event_id"]
    return store.ServingEventRow(
        organization_id=organization_id,
        tenant_id=tenant_id,
        product_version=row.get("_product_version") or "unknown",
        event_id=event_id,
        venue_id=row["venue_id"],
        event_date=row["event_date"],
        tickets_sold=row.get("tickets_sold"),
        gross_revenue=row.get("gross_revenue"),
        revenue_per_ticket=row.get("revenue_per_ticket"),
        source_updated_at=_aware_utc(row["_updated_at"]),
        serving_snapshot_id=str(serving_snapshot_id),
        source_change_token=_source_change_token(row),
        gold_pipeline_run_id=row.get("_gold_pipeline_run_id"),
        silver_pipeline_run_id=row.get("_silver_pipeline_run_id"),
        # Reserved for future exchange/ingestion lineage wiring -- Gold's
        # event-performance schema does not carry these (spec §8.18 only
        # needs *some* concrete internal field to prove never leaks; these
        # are clearly-synthetic placeholders, not real lineage).
        ingestion_id=f"ing-{event_id}",
        exchange_id=f"exch-{organization_id}",
        storage_path=f"s3://lakehouse-gold/event_performance/{organization_id}/{tenant_id}/{event_id}",
    )


def _max_updated_at(rows: list[dict[str, Any]], fallback: datetime) -> datetime:
    if not rows:
        return fallback
    return max(_aware_utc(r["_updated_at"]) for r in rows)


# product_version is stored as the literal wildcard "*" on projection_runs:
# a single refresh scans all of Gold at once, and Gold rows across tenants
# can legitimately carry different `_product_version` values (each row's
# own resolved version is preserved on the serving row itself via
# `_to_serving_row`). The run-level "*" is purely a stable key for
# `latest_successful_run`/`require_checkpoint` to look up the one checkpoint
# this projector maintains -- it is never surfaced to a customer.
def run_full_refresh(engine: Engine, catalog: Catalog) -> ProjectionOutcome:
    projection_run_id = new_projection_run_id()
    started_at = datetime.now(timezone.utc)

    with engine.begin() as conn:
        store.start_run(
            conn,
            projection_run_id=projection_run_id,
            product_id=PRODUCT_ID,
            product_version="*",
            refresh_type="FULL",
            started_at=started_at,
        )

    try:
        gold: BulkGoldRead = read_full(catalog, table_name=GOLD_TABLE_NAME)
        serving_snapshot_id = str(gold.resolved_snapshot_id)
        serving_rows = [_to_serving_row(r, serving_snapshot_id=serving_snapshot_id) for r in gold.rows]

        with engine.begin() as conn:
            store.truncate_staging(conn)
            written = store.bulk_insert_staging(conn, serving_rows)
            staged = store.staging_row_count(conn)
            if staged != written:
                raise ProjectionValidationError(
                    f"Staging row count {staged} does not match rows written {written} -- aborting, live table untouched."
                )
            store.swap_staging_into_live(conn)

            checkpoint = TimestampCheckpoint(value=_max_updated_at(gold.rows, epoch_checkpoint().value))
            store.complete_run(
                conn,
                projection_run_id=projection_run_id,
                source_snapshot=str(gold.resolved_snapshot_id),
                serving_snapshot_id=serving_snapshot_id,
                rows_read=gold.input_record_count,
                rows_written=written,
                checkpoint=checkpoint.to_dict(),
                completed_at=datetime.now(timezone.utc),
            )

        return ProjectionOutcome(
            projection_run_id=projection_run_id,
            status="SUCCEEDED",
            rows_read=gold.input_record_count,
            rows_written=written,
            serving_snapshot_id=serving_snapshot_id,
        )
    except Exception as exc:  # noqa: BLE001 -- must always record failure before re-raising
        with engine.begin() as conn:
            store.fail_run(
                conn,
                projection_run_id=projection_run_id,
                error_code=getattr(exc, "error_code", "INTERNAL_ERROR"),
                error_message=str(exc),
                completed_at=datetime.now(timezone.utc),
            )
        raise


def run_incremental_refresh(engine: Engine, catalog: Catalog) -> ProjectionOutcome:
    projection_run_id = new_projection_run_id()
    started_at = datetime.now(timezone.utc)

    with engine.begin() as conn:
        checkpoint_dict = store.require_checkpoint(conn, product_id=PRODUCT_ID, product_version="*")
        store.start_run(
            conn,
            projection_run_id=projection_run_id,
            product_id=PRODUCT_ID,
            product_version="*",
            refresh_type="INCREMENTAL",
            started_at=started_at,
        )

    checkpoint = TimestampCheckpoint.from_dict(checkpoint_dict)

    try:
        gold: BulkGoldRead = read_incremental(catalog, table_name=GOLD_TABLE_NAME, updated_since=_naive_utc(checkpoint.value))
        serving_snapshot_id = str(gold.resolved_snapshot_id)
        serving_rows = [_to_serving_row(r, serving_snapshot_id=serving_snapshot_id) for r in gold.rows]

        with engine.begin() as conn:
            written = store.upsert_live(conn, serving_rows)
            next_checkpoint = TimestampCheckpoint(value=_max_updated_at(gold.rows, checkpoint.value))
            store.complete_run(
                conn,
                projection_run_id=projection_run_id,
                source_snapshot=str(gold.resolved_snapshot_id),
                serving_snapshot_id=serving_snapshot_id,
                rows_read=gold.input_record_count,
                rows_written=written,
                checkpoint=next_checkpoint.to_dict(),
                completed_at=datetime.now(timezone.utc),
            )

        return ProjectionOutcome(
            projection_run_id=projection_run_id,
            status="SUCCEEDED",
            rows_read=gold.input_record_count,
            rows_written=written,
            serving_snapshot_id=serving_snapshot_id,
        )
    except Exception as exc:  # noqa: BLE001
        with engine.begin() as conn:
            store.fail_run(
                conn,
                projection_run_id=projection_run_id,
                error_code=getattr(exc, "error_code", "INTERNAL_ERROR"),
                error_message=str(exc),
                completed_at=datetime.now(timezone.utc),
            )
        raise
