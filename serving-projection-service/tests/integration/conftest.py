from datetime import date, datetime, timezone
from decimal import Decimal

import pytest
from sqlalchemy import text

from serving_projection.metadata.engine import get_engine
from serving_projection.metadata.migrations import run_migrations


@pytest.fixture(scope="session", autouse=True)
def _ensure_migrated():
    run_migrations(get_engine())


@pytest.fixture
def engine():
    return get_engine()


@pytest.fixture(autouse=True)
def _truncate_between_tests(engine):
    with engine.begin() as conn:
        conn.execute(text("TRUNCATE api_serving.event_performance_events, api_serving.event_performance_events_staging, api_serving.projection_runs"))
    yield


def make_row(**overrides):
    from serving_projection.serving_store.repository import ServingEventRow

    defaults = dict(
        organization_id="org-a",
        tenant_id="tenant-a",
        product_version="1.0.0",
        event_id="EVT1001",
        venue_id="VEN001",
        event_date=date(2026, 9, 1),
        tickets_sold=1200,
        gross_revenue=Decimal("84000.00"),
        revenue_per_ticket=Decimal("70.00"),
        source_updated_at=datetime(2026, 9, 1, 6, 0, tzinfo=timezone.utc),
        serving_snapshot_id="snap-1",
        source_change_token="token-1",
        gold_pipeline_run_id="gpr-1",
        silver_pipeline_run_id="spr-1",
        ingestion_id="ing-1",
        exchange_id="exch-1",
        storage_path="s3://gold/event_performance/org-a/tenant-a/EVT1001",
    )
    defaults.update(overrides)
    return ServingEventRow(**defaults)
