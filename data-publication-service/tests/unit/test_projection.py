from datetime import date
from decimal import Decimal

import pytest

from publication.common.errors import SchemaProjectionError
from publication.contracts.loader import load_publication_contract
from publication.transformations.projection import assert_no_unauthorized_columns, project_published_schema

CONTRACT = load_publication_contract("event-performance")

# Values mirror what a real PyIceberg scan returns via .to_arrow().to_pylist()
# -- date32 -> datetime.date, decimal128 -> decimal.Decimal -- not raw strings.
GOLD_ROW = {
    "organization_id": "org-vobis-org-722aea",
    "tenant_id": "tenant-default-47d849",
    "event_id": "evt-1",
    "venue_id": "ven-1",
    "event_date": date(2026, 9, 6),
    "tickets_sold": 100,
    "gross_revenue": Decimal("1234.56"),
    "revenue_per_ticket": Decimal("12.35"),
    "_gold_pipeline_run_id": "run-abc",
    "_silver_pipeline_run_id": "run-def",
    "_product_id": "event-performance",
    "_product_version": "1.0",
    "_created_at": "2026-09-06T00:00:00",
    "_updated_at": "2026-09-06T00:00:00",
}


def test_projection_keeps_only_contract_columns():
    table = project_published_schema([GOLD_ROW], CONTRACT)
    assert set(table.column_names) == {"event_id", "venue_id", "event_date", "tickets_sold", "gross_revenue", "revenue_per_ticket"}
    assert "organization_id" not in table.column_names
    assert "tenant_id" not in table.column_names
    assert "_gold_pipeline_run_id" not in table.column_names
    assert "_product_id" not in table.column_names


def test_assert_no_unauthorized_columns_passes_for_projected_table():
    table = project_published_schema([GOLD_ROW], CONTRACT)
    assert_no_unauthorized_columns(table, CONTRACT)  # must not raise


def test_missing_required_source_column_raises():
    bad_row = dict(GOLD_ROW)
    del bad_row["event_id"]
    with pytest.raises(SchemaProjectionError):
        project_published_schema([bad_row], CONTRACT)


def test_null_required_column_raises():
    bad_row = dict(GOLD_ROW)
    bad_row["venue_id"] = None
    with pytest.raises(SchemaProjectionError):
        project_published_schema([bad_row], CONTRACT)
