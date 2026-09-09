from datetime import datetime, timezone
from decimal import Decimal

import pytest
from sqlalchemy import text

from serving_projection.common.errors import NoPriorSuccessfulRunError
from serving_projection.serving_store import repository as store
from tests.integration.conftest import make_row


def test_full_refresh_staging_swap_is_atomic_and_tenant_isolated(engine):
    row_a = make_row(organization_id="org-a", tenant_id="tenant-a", event_id="EVT1001", venue_id="VEN001", tickets_sold=1200)
    row_b = make_row(organization_id="org-b", tenant_id="tenant-b", event_id="EVT1001", venue_id="VEN999", tickets_sold=3000)

    with engine.begin() as conn:
        store.truncate_staging(conn)
        written = store.bulk_insert_staging(conn, [row_a, row_b])
        assert written == 2
        store.swap_staging_into_live(conn)

    with engine.connect() as conn:
        live_rows = conn.execute(text("SELECT organization_id, tenant_id, tickets_sold FROM api_serving.event_performance_events ORDER BY organization_id")).mappings().all()
        staging_count = conn.execute(text("SELECT count(*) FROM api_serving.event_performance_events_staging")).scalar_one()

    assert [dict(r) for r in live_rows] == [
        {"organization_id": "org-a", "tenant_id": "tenant-a", "tickets_sold": 1200},
        {"organization_id": "org-b", "tenant_id": "tenant-b", "tickets_sold": 3000},
    ]
    # Staging is empty again immediately after a successful swap, ready for
    # the next full refresh.
    assert staging_count == 0


def test_a_failed_staging_load_never_touches_the_live_table(engine):
    live_row = make_row(organization_id="org-a", tenant_id="tenant-a", event_id="EVT1001", tickets_sold=1200)
    with engine.begin() as conn:
        store.truncate_staging(conn)
        store.bulk_insert_staging(conn, [live_row])
        store.swap_staging_into_live(conn)

    # Simulate a validation failure mid-refresh: the transaction is never
    # committed, so `live` must retain the previous successful snapshot.
    try:
        with engine.begin() as conn:
            store.truncate_staging(conn)
            store.bulk_insert_staging(conn, [make_row(event_id="EVT9999")])
            raise RuntimeError("simulated validation failure")
    except RuntimeError:
        pass

    with engine.connect() as conn:
        live_event_ids = conn.execute(text("SELECT event_id FROM api_serving.event_performance_events")).scalars().all()
    assert live_event_ids == ["EVT1001"]


def test_upsert_live_updates_one_tenant_without_touching_another(engine):
    row_a = make_row(organization_id="org-a", tenant_id="tenant-a", event_id="EVT1001", tickets_sold=1200, gross_revenue=Decimal("84000.00"))
    row_b = make_row(organization_id="org-b", tenant_id="tenant-b", event_id="EVT1001", tickets_sold=3000, gross_revenue=Decimal("250000.00"))
    with engine.begin() as conn:
        store.upsert_live(conn, [row_a, row_b])

    updated_a = make_row(organization_id="org-a", tenant_id="tenant-a", event_id="EVT1001", tickets_sold=1500, gross_revenue=Decimal("99000.00"))
    with engine.begin() as conn:
        store.upsert_live(conn, [updated_a])

    with engine.connect() as conn:
        rows = {
            (r["organization_id"], r["tenant_id"]): r["tickets_sold"]
            for r in conn.execute(text("SELECT organization_id, tenant_id, tickets_sold FROM api_serving.event_performance_events")).mappings().all()
        }
    assert rows[("org-a", "tenant-a")] == 1500
    assert rows[("org-b", "tenant-b")] == 3000


def test_run_lifecycle_and_checkpoint_tracking(engine):
    with engine.begin() as conn:
        store.start_run(conn, projection_run_id="proj-1", product_id="event-performance", product_version="*", refresh_type="FULL", started_at=datetime.now(timezone.utc))

    with engine.begin() as conn:
        with pytest.raises(NoPriorSuccessfulRunError):
            store.require_checkpoint(conn, product_id="event-performance", product_version="*")

    with engine.begin() as conn:
        store.complete_run(
            conn,
            projection_run_id="proj-1",
            source_snapshot="snap-1",
            serving_snapshot_id="snap-1",
            rows_read=2,
            rows_written=2,
            checkpoint={"type": "timestamp", "value": "2026-09-01T06:00:00+00:00"},
            completed_at=datetime.now(timezone.utc),
        )

    with engine.begin() as conn:
        checkpoint = store.require_checkpoint(conn, product_id="event-performance", product_version="*")
    assert checkpoint == {"type": "timestamp", "value": "2026-09-01T06:00:00+00:00"}

    with engine.connect() as conn:
        run = store.get_run(conn, "proj-1")
    assert run["status"] == "SUCCEEDED"
    assert run["rows_written"] == 2


def test_fail_run_records_error_and_excludes_it_from_latest_successful(engine):
    with engine.begin() as conn:
        store.start_run(conn, projection_run_id="proj-fail", product_id="event-performance", product_version="*", refresh_type="FULL", started_at=datetime.now(timezone.utc))
        store.fail_run(conn, projection_run_id="proj-fail", error_code="PROJECTION_VALIDATION_FAILED", error_message="boom", completed_at=datetime.now(timezone.utc))

    with engine.connect() as conn:
        latest = store.latest_successful_run(conn, product_id="event-performance", product_version="*")
    assert latest is None
