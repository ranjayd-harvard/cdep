"""Quality policy evaluation (AGENTS.md section 18).

Turns a list of per-rule evaluations into a single decision: which specific
records to quarantine, and whether the whole pipeline run should fail.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from lakehouse.contracts.models import QualityPolicyConfig
from lakehouse.quality.results import QualityRuleEvaluation


@dataclass
class QualityDecision:
    should_fail_pipeline: bool
    quarantine_indices: set[int] = field(default_factory=set)
    error_rule_names: list[str] = field(default_factory=list)


def evaluate_policy(
    evaluations: list[QualityRuleEvaluation], policy: QualityPolicyConfig
) -> QualityDecision:
    error_evals = [e for e in evaluations if e.severity == "ERROR" and not e.passed]
    if not error_evals:
        return QualityDecision(should_fail_pipeline=False)

    quarantine_indices: set[int] = set()
    for e in error_evals:
        quarantine_indices |= e.failed_indices

    over_threshold = any(
        e.failure_percentage > policy.error_threshold_percent for e in error_evals
    )

    should_fail = policy.on_failure.fail_pipeline and over_threshold
    return QualityDecision(
        should_fail_pipeline=should_fail,
        quarantine_indices=quarantine_indices if policy.on_failure.quarantine_invalid_records else set(),
        error_rule_names=[e.rule_name for e in error_evals],
    )
