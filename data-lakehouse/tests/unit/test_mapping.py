from __future__ import annotations

from decimal import Decimal

from lakehouse.transformations.mapping import apply_mapping, load_mapping


def test_load_mapping_parses_event_data_to_event():
    mapping = load_mapping("event-data-to-event")
    assert mapping.source_table == "bronze.event_data"
    assert mapping.source_data_product_id == "event-data"
    assert mapping.target_table == "silver.event"
    assert mapping.target_entity == "event"
    assert mapping.business_key == ["event_id"]
    assert set(mapping.fields) == {"event_id", "venue_id", "event_date", "tickets_sold", "gross_revenue"}


def test_apply_mapping_casts_bronze_strings_to_canonical_types():
    mapping = load_mapping("event-data-to-event")
    bronze_row = {
        "event_id": "EVT1001",
        "venue_id": "VEN001",
        "event_date": "2026-09-01",
        "tickets_sold": "1200",
        "gross_revenue": "84000.00",
        "_exchange_id": "exc-1",
        "_ingestion_id": "ing-1",
    }
    result = apply_mapping(bronze_row, mapping)
    assert result.error is None
    assert result.record["event_id"] == "EVT1001"
    assert result.record["tickets_sold"] == 1200
    assert result.record["gross_revenue"] == Decimal("84000.00")
    from datetime import date

    assert result.record["event_date"] == date(2026, 9, 1)


def test_apply_mapping_rejects_missing_required_field():
    mapping = load_mapping("event-data-to-event")
    bronze_row = {
        "event_id": None,
        "venue_id": "VEN001",
        "event_date": "2026-09-01",
        "tickets_sold": "1200",
        "gross_revenue": "84000.00",
    }
    result = apply_mapping(bronze_row, mapping)
    assert result.error is not None
    assert result.record is None
    assert result.failed_field == "event_id"


def test_apply_mapping_rejects_unparseable_required_date():
    mapping = load_mapping("event-data-to-event")
    bronze_row = {
        "event_id": "EVT1001",
        "venue_id": "VEN001",
        "event_date": "not-a-date",
        "tickets_sold": "1200",
        "gross_revenue": "84000.00",
    }
    result = apply_mapping(bronze_row, mapping)
    assert result.error is not None
    assert result.record is None


def test_apply_mapping_allows_missing_optional_numeric_fields():
    mapping = load_mapping("event-data-to-event")
    bronze_row = {
        "event_id": "EVT1001",
        "venue_id": "VEN001",
        "event_date": "2026-09-01",
        "tickets_sold": None,
        "gross_revenue": None,
    }
    result = apply_mapping(bronze_row, mapping)
    assert result.error is None
    assert result.record["tickets_sold"] is None
    assert result.record["gross_revenue"] is None
