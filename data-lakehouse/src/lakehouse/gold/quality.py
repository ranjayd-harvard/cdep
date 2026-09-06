"""Gold quality adapter (AGENTS.md section 30) -- same engine/policy
machinery as Silver, plus the grain-uniqueness check that is specific to
Gold Data Products (AGENTS.md section 25)."""

from __future__ import annotations

from typing import Any

from lakehouse.contracts.models import GoldDataProductContract
from lakehouse.contracts.validator import GoldGrainAmbiguousError, validate_gold_grain
from lakehouse.quality.engine import run_quality_rules
from lakehouse.quality.results import QualityRuleEvaluation
from lakehouse.quality.thresholds import QualityDecision, evaluate_policy


def evaluate_gold_quality(
    records: list[dict[str, Any]], contract: GoldDataProductContract
) -> tuple[list[QualityRuleEvaluation], QualityDecision]:
    evaluations = run_quality_rules(records, contract.quality.rules)
    decision = evaluate_policy(evaluations, contract.quality.policy)
    return evaluations, decision


def assert_grain(records: list[dict[str, Any]], contract: GoldDataProductContract) -> None:
    """A Gold Data Product must never emit GoldReady with an ambiguous
    grain. Raises `GoldGrainAmbiguousError` (a `LakehouseError`) rather than
    returning a soft warning -- this is a hard publication-readiness gate."""
    validate_gold_grain(records, contract)


__all__ = ["evaluate_gold_quality", "assert_grain", "GoldGrainAmbiguousError"]
