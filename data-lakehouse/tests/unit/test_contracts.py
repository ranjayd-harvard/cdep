from __future__ import annotations

from lakehouse.contracts.loader import load_gold_contract, load_silver_contract


def test_load_silver_event_contract():
    contract = load_silver_contract("event")
    assert contract.entity == "event"
    assert contract.version == "1.0"
    assert contract.business_key == ["organization_id", "tenant_id", "event_id"]
    rule_names = {r.name for r in contract.quality.rules}
    assert "event_id_required" in rule_names
    assert "tickets_non_negative" in rule_names
    assert contract.quality.policy.on_failure.quarantine_invalid_records is True
    assert contract.quality.policy.on_failure.fail_pipeline is False


def test_load_gold_event_performance_contract():
    contract = load_gold_contract("event-performance")
    assert contract.data_product_id == "event-performance"
    assert contract.version == "1.0"
    assert contract.keys == ["organization_id", "tenant_id", "event_id"]
    assert contract.source.table == "silver.event"
    assert "revenue_per_ticket" in contract.schema_
    assert contract.sla.freshness_minutes == 240
