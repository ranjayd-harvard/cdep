from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from serving_projection.api.auth import require_internal_api_key
from serving_projection.common.errors import ProjectionRunNotFoundError, ServingProjectionError
from serving_projection.lakehouse.iceberg_reader import get_catalog
from serving_projection.metadata.engine import get_engine
from serving_projection.projection.event_performance_projector import run_full_refresh, run_incremental_refresh
from serving_projection.serving_store import repository as store

router = APIRouter(dependencies=[Depends(require_internal_api_key)])


class TriggerProjectionIn(BaseModel):
    refresh_type: Literal["FULL", "INCREMENTAL"] = "FULL"


@router.post("/internal/v1/projection-runs")
def trigger_projection(body: TriggerProjectionIn) -> dict:
    engine = get_engine()
    catalog = get_catalog()
    try:
        if body.refresh_type == "FULL":
            outcome = run_full_refresh(engine, catalog)
        else:
            outcome = run_incremental_refresh(engine, catalog)
    except ServingProjectionError as exc:
        raise HTTPException(status_code=409, detail={"error_code": exc.error_code, "message": exc.message}) from exc
    return {
        "projection_run_id": outcome.projection_run_id,
        "status": outcome.status,
        "rows_read": outcome.rows_read,
        "rows_written": outcome.rows_written,
        "serving_snapshot_id": outcome.serving_snapshot_id,
    }


@router.get("/internal/v1/projection-runs")
def list_projection_runs(limit: int = 50) -> list[dict]:
    engine = get_engine()
    with engine.connect() as conn:
        return _json_safe(store.list_runs(conn, limit=limit))


@router.get("/internal/v1/projection-runs/{projection_run_id}")
def get_projection_run(projection_run_id: str) -> dict:
    engine = get_engine()
    with engine.connect() as conn:
        try:
            return _json_safe([store.get_run(conn, projection_run_id)])[0]
        except ProjectionRunNotFoundError as exc:
            raise HTTPException(status_code=404, detail={"error_code": exc.error_code, "message": exc.message}) from exc


def _json_safe(rows: list[dict]) -> list[dict]:
    import datetime as dt

    def convert(value):
        if isinstance(value, (dt.datetime, dt.date)):
            return value.isoformat()
        return value

    return [{k: convert(v) for k, v in row.items()} for row in rows]
