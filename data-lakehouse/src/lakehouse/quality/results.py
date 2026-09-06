from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class ValidationResult:
    ok: bool
    checks_passed: list[str] = field(default_factory=list)
    error_code: str | None = None
    error_message: str | None = None


@dataclass
class QualityRuleEvaluation:
    """Result of evaluating one quality rule against a batch of Silver/Gold
    records (AGENTS.md section 17). `failed_indices` lets the caller
    quarantine exactly the offending rows rather than the whole batch."""

    rule_name: str
    rule_type: str
    severity: str  # INFO | WARNING | ERROR

    total_count: int
    failed_count: int
    failure_percentage: float
    passed: bool

    failed_indices: set[int] = field(default_factory=set)
