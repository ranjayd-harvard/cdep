from __future__ import annotations

from lakehouse.contracts.models import QualityPolicyConfig, QualityRuleConfig
from lakehouse.quality.engine import run_quality_rules
from lakehouse.quality.thresholds import evaluate_policy

RULES = [
    QualityRuleConfig(name="event_id_required", type="not_null", column="event_id", severity="ERROR"),
    QualityRuleConfig(name="tickets_non_negative", type="min", column="tickets_sold", value=0, severity="ERROR"),
]


def test_not_null_rule_flags_missing_values():
    records = [{"event_id": "EVT1", "tickets_sold": 10}, {"event_id": None, "tickets_sold": 5}]
    results = run_quality_rules(records, RULES)
    not_null_result = next(r for r in results if r.rule_name == "event_id_required")
    assert not_null_result.failed_count == 1
    assert not_null_result.failed_indices == {1}
    assert not_null_result.passed is False


def test_min_rule_flags_negative_values():
    records = [{"event_id": "EVT1", "tickets_sold": -5}, {"event_id": "EVT2", "tickets_sold": 10}]
    results = run_quality_rules(records, RULES)
    min_result = next(r for r in results if r.rule_name == "tickets_non_negative")
    assert min_result.failed_indices == {0}


def test_all_passing_records_yield_no_failures():
    records = [{"event_id": "EVT1", "tickets_sold": 10}, {"event_id": "EVT2", "tickets_sold": 20}]
    results = run_quality_rules(records, RULES)
    assert all(r.passed for r in results)


def test_empty_batch_produces_zero_totals_without_error():
    results = run_quality_rules([], RULES)
    assert all(r.total_count == 0 and r.passed for r in results)


def test_policy_quarantines_but_does_not_fail_pipeline_by_default():
    records = [{"event_id": "EVT1", "tickets_sold": -5}, {"event_id": "EVT2", "tickets_sold": 10}]
    evaluations = run_quality_rules(records, RULES)
    policy = QualityPolicyConfig(error_threshold_percent=1.0)
    decision = evaluate_policy(evaluations, policy)
    assert decision.should_fail_pipeline is False
    assert decision.quarantine_indices == {0}


def test_policy_fails_pipeline_when_configured_and_over_threshold():
    records = [{"event_id": "EVT1", "tickets_sold": -5}, {"event_id": "EVT2", "tickets_sold": -10}]
    evaluations = run_quality_rules(records, RULES)
    policy = QualityPolicyConfig(error_threshold_percent=1.0)
    policy.on_failure.fail_pipeline = True
    decision = evaluate_policy(evaluations, policy)
    assert decision.should_fail_pipeline is True
