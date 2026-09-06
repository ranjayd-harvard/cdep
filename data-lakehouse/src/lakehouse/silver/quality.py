"""Silver quality adapter: runs the generic quality engine against the
Silver contract's rules and turns the result into a quarantine decision
(AGENTS.md sections 17/18)."""

from __future__ import annotations

from typing import Any

from lakehouse.contracts.models import SilverContract
from lakehouse.quality.engine import run_quality_rules
from lakehouse.quality.results import QualityRuleEvaluation
from lakehouse.quality.thresholds import QualityDecision, evaluate_policy


def evaluate_silver_quality(
    records: list[dict[str, Any]], contract: SilverContract
) -> tuple[list[QualityRuleEvaluation], QualityDecision]:
    evaluations = run_quality_rules(records, contract.quality.rules)
    decision = evaluate_policy(evaluations, contract.quality.policy)
    return evaluations, decision
