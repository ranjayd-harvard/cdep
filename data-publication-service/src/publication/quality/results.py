from __future__ import annotations

from dataclasses import dataclass


@dataclass
class QualityRuleResult:
    rule_name: str
    severity: str  # ERROR | WARNING
    total_count: int
    failed_count: int
    passed: bool


@dataclass
class QualityDecision:
    results: list[QualityRuleResult]

    @property
    def should_fail_publication(self) -> bool:
        return any(not r.passed and r.severity == "ERROR" for r in self.results)

    @property
    def failed_rule_names(self) -> list[str]:
        return [r.rule_name for r in self.results if not r.passed and r.severity == "ERROR"]
