from __future__ import annotations

from datetime import datetime, timezone

from lakehouse.silver.deduplicator import deduplicate

BUSINESS_KEY = ["organization_id", "tenant_id", "event_id"]


def _pair(event_id: str, received_at: datetime, tenant_id: str = "tenant-A", tickets: int = 100):
    canonical = {
        "organization_id": "org-A",
        "tenant_id": tenant_id,
        "event_id": event_id,
        "tickets_sold": tickets,
    }
    bronze_row = {"_source_received_at": received_at, "_ingested_at": received_at}
    return canonical, bronze_row


def test_keeps_single_record_unchanged():
    pairs = [_pair("EVT1", datetime(2026, 1, 1, tzinfo=timezone.utc))]
    kept, dropped = deduplicate(pairs, business_key=BUSINESS_KEY, order_by="_source_received_at", tiebreaker="_ingested_at")
    assert len(kept) == 1
    assert dropped == 0


def test_duplicate_business_key_keeps_latest_received_at():
    older = _pair("EVT1", datetime(2026, 1, 1, tzinfo=timezone.utc), tickets=100)
    newer = _pair("EVT1", datetime(2026, 1, 2, tzinfo=timezone.utc), tickets=200)
    kept, dropped = deduplicate(
        [older, newer], business_key=BUSINESS_KEY, order_by="_source_received_at", tiebreaker="_ingested_at"
    )
    assert dropped == 1
    assert len(kept) == 1
    assert kept[0]["tickets_sold"] == 200


def test_tiebreaker_used_when_order_by_equal():
    same_received = datetime(2026, 1, 1, tzinfo=timezone.utc)
    first, first_row = _pair("EVT1", same_received, tickets=100)
    second, second_row = _pair("EVT1", same_received, tickets=200)
    second_row["_ingested_at"] = datetime(2026, 1, 2, tzinfo=timezone.utc)
    kept, dropped = deduplicate(
        [(first, first_row), (second, second_row)],
        business_key=BUSINESS_KEY,
        order_by="_source_received_at",
        tiebreaker="_ingested_at",
    )
    assert dropped == 1
    assert kept[0]["tickets_sold"] == 200


def test_never_deduplicates_across_tenants():
    tenant_a = _pair("EVT1", datetime(2026, 1, 1, tzinfo=timezone.utc), tenant_id="tenant-A")
    tenant_b = _pair("EVT1", datetime(2026, 1, 1, tzinfo=timezone.utc), tenant_id="tenant-B")
    kept, dropped = deduplicate(
        [tenant_a, tenant_b], business_key=BUSINESS_KEY, order_by="_source_received_at", tiebreaker="_ingested_at"
    )
    assert dropped == 0
    assert len(kept) == 2
    assert {r["tenant_id"] for r in kept} == {"tenant-A", "tenant-B"}
