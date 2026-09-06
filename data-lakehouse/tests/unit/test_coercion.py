from __future__ import annotations

from lakehouse.bronze.coercion import coerce_business_record
from lakehouse.config.models import SchemaFieldConfig

FIELDS = [
    SchemaFieldConfig(name="event_id", type="string", required=True),
    SchemaFieldConfig(name="tickets_sold", type="long", required=False),
    SchemaFieldConfig(name="gross_revenue", type="double", required=False),
]


def test_coerces_csv_style_strings_to_declared_numeric_types():
    result = coerce_business_record(
        {"event_id": "EVT1", "tickets_sold": "1200", "gross_revenue": "84000.00"}, FIELDS
    )
    assert result.error is None
    assert result.record == {"event_id": "EVT1", "tickets_sold": 1200, "gross_revenue": 84000.0}


def test_leaves_already_native_typed_json_values_alone():
    result = coerce_business_record(
        {"event_id": "EVT1", "tickets_sold": 500, "gross_revenue": 35000.0}, FIELDS
    )
    assert result.error is None
    assert result.record == {"event_id": "EVT1", "tickets_sold": 500, "gross_revenue": 35000.0}


def test_non_numeric_value_in_numeric_field_is_rejected_not_coerced():
    result = coerce_business_record(
        {"event_id": "EVT1", "tickets_sold": "not-a-number", "gross_revenue": "84000.00"}, FIELDS
    )
    assert result.error is not None
    assert result.record is None


def test_empty_string_coerces_to_none_for_optional_numeric_field():
    result = coerce_business_record(
        {"event_id": "EVT1", "tickets_sold": "", "gross_revenue": "84000.00"}, FIELDS
    )
    assert result.error is None
    assert result.record["tickets_sold"] is None


def test_undeclared_columns_pass_through_untouched():
    result = coerce_business_record(
        {"event_id": "EVT1", "tickets_sold": "1200", "gross_revenue": "84000.00", "extra": "value"},
        FIELDS,
    )
    assert result.error is None
    assert result.record["extra"] == "value"
