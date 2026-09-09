from datetime import date, datetime, timezone
from decimal import Decimal

from serving_projection.projection.event_performance_projector import (
    _max_updated_at,
    _source_change_token,
    _to_serving_row,
)

GOLD_ROW = {
    "organization_id": "org-a",
    "tenant_id": "tenant-a",
    "event_id": "EVT1001",
    "venue_id": "VEN001",
    "event_date": date(2026, 9, 1),
    "tickets_sold": 1200,
    "gross_revenue": Decimal("84000.00"),
    "revenue_per_ticket": Decimal("70.00"),
    "_gold_pipeline_run_id": "gpr-1",
    "_silver_pipeline_run_id": "spr-1",
    "_product_id": "event-performance",
    "_product_version": "1.0.0",
    "_updated_at": datetime(2026, 9, 1, 6, 0, 0),
}


def test_source_change_token_is_deterministic():
    assert _source_change_token(GOLD_ROW) == _source_change_token(GOLD_ROW)


def test_source_change_token_changes_when_published_field_changes():
    changed = {**GOLD_ROW, "tickets_sold": 1201}
    assert _source_change_token(GOLD_ROW) != _source_change_token(changed)


def test_source_change_token_is_stable_when_internal_field_changes():
    # Internal lineage fields must never affect the token -- only the
    # published fields the customer can actually see should.
    changed = {**GOLD_ROW, "_gold_pipeline_run_id": "gpr-2"}
    assert _source_change_token(GOLD_ROW) == _source_change_token(changed)


def test_to_serving_row_maps_published_and_internal_fields():
    row = _to_serving_row(GOLD_ROW, serving_snapshot_id="snap-1")
    assert row.organization_id == "org-a"
    assert row.tenant_id == "tenant-a"
    assert row.event_id == "EVT1001"
    assert row.venue_id == "VEN001"
    assert row.tickets_sold == 1200
    assert row.gross_revenue == Decimal("84000.00")
    assert row.product_version == "1.0.0"
    assert row.serving_snapshot_id == "snap-1"
    assert row.gold_pipeline_run_id == "gpr-1"
    assert row.silver_pipeline_run_id == "spr-1"
    # Placeholder lineage fields (spec §8.18) are always populated, never null.
    assert row.ingestion_id
    assert row.exchange_id
    assert row.storage_path


def test_max_updated_at_falls_back_when_no_rows():
    fallback = datetime(2020, 1, 1, tzinfo=timezone.utc)
    assert _max_updated_at([], fallback) == fallback


def test_max_updated_at_picks_the_latest_row():
    rows = [
        {"_updated_at": datetime(2026, 9, 1, 6, 0, 0)},
        {"_updated_at": datetime(2026, 9, 2, 6, 0, 0)},
    ]
    result = _max_updated_at(rows, datetime(2020, 1, 1, tzinfo=timezone.utc))
    assert result.date() == date(2026, 9, 2)
