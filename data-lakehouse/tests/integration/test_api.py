"""Integration tests for the superadmin portal's internal HTTP API
(src/lakehouse/api/). Uses FastAPI's TestClient (httpx-based) directly
against the router -- no uvicorn process needed.

Auth is exercised against an explicit, overridden Settings instance (via
FastAPI's dependency_overrides for `get_settings`) rather than the real
process-wide `get_settings()` singleton, so these tests don't depend on
whatever LAKEHOUSE_INTERNAL_API_KEY happens to be set (or not) in whichever
env first triggered that lru_cache in this test session.
"""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.testclient import TestClient

from lakehouse.api.routes import router
from lakehouse.config.settings import Settings, get_settings
from tests.integration.conftest import requires_local_stack

_TEST_KEY = "test-internal-key"


def _client(ingestion_service=None) -> TestClient:
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_settings] = lambda: Settings(internal_api_key=_TEST_KEY)
    if ingestion_service is not None:
        app.state.ingestion_service = ingestion_service
    return TestClient(app)


def test_missing_key_is_rejected():
    client = _client()
    response = client.get("/internal/v1/ingestion-runs")
    assert response.status_code == 403


def test_wrong_key_is_rejected():
    client = _client()
    response = client.get(
        "/internal/v1/ingestion-runs", headers={"x-internal-api-key": "wrong"}
    )
    assert response.status_code == 403


def test_list_with_no_rows_returns_empty_list():
    client = _client()
    response = client.get(
        "/internal/v1/ingestion-runs",
        params={"exchange_id": "exc-does-not-exist"},
        headers={"x-internal-api-key": _TEST_KEY},
    )
    assert response.status_code == 200
    assert response.json() == []


@requires_local_stack
def test_trigger_nonexistent_exchange_returns_404(service):
    client = _client(ingestion_service=service)
    response = client.post(
        "/internal/v1/ingestion-runs",
        json={"exchange_id": "exc-definitely-does-not-exist"},
        headers={"x-internal-api-key": _TEST_KEY},
    )
    assert response.status_code == 404
    assert response.json()["detail"]["error_code"] == "EXCHANGE_NOT_FOUND"


@requires_local_stack
def test_trigger_and_list_happy_path(service, data_product, stage_exchange, unique_id):
    data_product_id, table_name = data_product
    exchange_id = f"exc-api-it-{unique_id}"
    stage_exchange(
        exchange_id=exchange_id,
        organization_id="org-api-it",
        tenant_id="tenant-api-it",
        data_product_id=data_product_id,
        file_bytes=b"event_id,venue_id,event_date,tickets_sold,gross_revenue\n"
        b"evt-1,ven-1,2026-01-01,10,100.0\n",
        filename="events.csv",
        fmt="CSV",
    )
    headers = {"x-internal-api-key": _TEST_KEY}
    client = _client(ingestion_service=service)

    before = client.get(
        "/internal/v1/ingestion-runs", params={"exchange_id": exchange_id}, headers=headers
    )
    assert before.status_code == 200
    assert before.json() == []

    triggered = client.post(
        "/internal/v1/ingestion-runs", json={"exchange_id": exchange_id}, headers=headers
    )
    assert triggered.status_code == 200
    body = triggered.json()
    assert body["status"] == "COMPLETED"
    assert body["bronze_table"] == f"bronze.{table_name}"
    assert body["bronze_record_count"] == 1

    after = client.get(
        "/internal/v1/ingestion-runs", params={"exchange_id": exchange_id}, headers=headers
    )
    assert after.status_code == 200
    runs = after.json()
    assert len(runs) == 1
    assert runs[0]["status"] == "COMPLETED"
    assert runs[0]["exchange_id"] == exchange_id


# ---------------------------------------------------------------------------
# Phase 3: pipeline-run / data-product endpoints. These call get_settings()/
# get_catalog()/get_engine() directly (not via app.state), so they exercise
# the real local stack rather than the auth-only Settings override above.
# ---------------------------------------------------------------------------


@requires_local_stack
def test_trigger_bronze_to_silver_and_silver_to_gold_via_api(
    service, data_product, stage_exchange, phase3_registration, unique_id
):
    data_product_id = phase3_registration["data_product_id"]
    gold_product_id = phase3_registration["gold_product_id"]
    exchange_id = f"exc-api-it-{unique_id}-phase3"
    stage_exchange(
        exchange_id=exchange_id,
        organization_id="org-api-it",
        tenant_id="tenant-api-it",
        data_product_id=data_product_id,
        file_bytes=b"event_id,venue_id,event_date,tickets_sold,gross_revenue\n"
        b"EVT-API-1,VEN-API,2026-01-01,10,100.0\n",
        filename="events.csv",
        fmt="CSV",
    )
    ingestion_outcome = service.run(exchange_id)
    assert ingestion_outcome.status.value == "COMPLETED"

    headers = {"x-internal-api-key": _TEST_KEY}
    client = _client(ingestion_service=service)

    silver_response = client.post(
        "/internal/v1/pipeline-runs/bronze-to-silver",
        json={"ingestion_id": ingestion_outcome.ingestion_id},
        headers=headers,
    )
    assert silver_response.status_code == 200
    silver_body = silver_response.json()
    assert silver_body["status"] == "COMPLETED"
    assert silver_body["output_record_count"] == 1
    silver_run_id = silver_body["pipeline_run_id"]

    gold_response = client.post(
        "/internal/v1/pipeline-runs/silver-to-gold",
        json={"silver_run_id": silver_run_id, "product_id": gold_product_id},
        headers=headers,
    )
    assert gold_response.status_code == 200
    gold_body = gold_response.json()
    assert len(gold_body) == 1
    assert gold_body[0]["status"] == "COMPLETED"

    detail_response = client.get(f"/internal/v1/pipeline-runs/{silver_run_id}", headers=headers)
    assert detail_response.status_code == 200
    detail = detail_response.json()
    assert detail["run"]["pipeline_run_id"] == silver_run_id
    assert len(detail["quality_results"]) >= 5
    assert all(r["passed"] for r in detail["quality_results"])
    assert any(e["target_type"] == "silver_table" for e in detail["lineage_edges"])


@requires_local_stack
def test_pipeline_run_detail_404_for_unknown_run(service):
    headers = {"x-internal-api-key": _TEST_KEY}
    client = _client(ingestion_service=service)
    response = client.get("/internal/v1/pipeline-runs/run-does-not-exist", headers=headers)
    assert response.status_code == 404


@requires_local_stack
def test_data_products_lists_seeded_event_performance():
    client = _client()
    response = client.get(
        "/internal/v1/data-products", headers={"x-internal-api-key": _TEST_KEY}
    )
    assert response.status_code == 200
    products = {p["data_product_id"]: p for p in response.json()}
    assert "event-performance" in products
    assert products["event-performance"]["gold_table"] == "gold.event_performance"


def test_data_product_rows_404_for_unregistered_product():
    client = _client()
    response = client.get(
        "/internal/v1/data-products/not-a-real-product/rows",
        headers={"x-internal-api-key": _TEST_KEY},
    )
    assert response.status_code == 404
