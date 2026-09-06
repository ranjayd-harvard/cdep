from __future__ import annotations

from datetime import date
from decimal import Decimal

from lakehouse.gold.products.event_performance import (
    build_event_performance,
    compute_revenue_per_ticket,
)


def test_revenue_per_ticket_divides_correctly():
    assert compute_revenue_per_ticket(Decimal("84000.00"), 1200) == Decimal("70.00")


def test_revenue_per_ticket_handles_zero_tickets_without_error():
    assert compute_revenue_per_ticket(Decimal("1000.00"), 0) is None


def test_revenue_per_ticket_handles_none_tickets_without_error():
    assert compute_revenue_per_ticket(Decimal("1000.00"), None) is None


def test_revenue_per_ticket_handles_none_revenue():
    assert compute_revenue_per_ticket(None, 100) is None


def test_build_event_performance_computes_grain_and_metric():
    silver_rows = [
        {
            "organization_id": "org-A",
            "tenant_id": "tenant-A",
            "event_id": "EVT1001",
            "venue_id": "VEN001",
            "event_date": date(2026, 9, 1),
            "tickets_sold": 1200,
            "gross_revenue": Decimal("84000.00"),
        }
    ]
    records = build_event_performance(silver_rows)
    assert len(records) == 1
    assert records[0]["revenue_per_ticket"] == Decimal("70.00")
    assert records[0]["event_id"] == "EVT1001"
