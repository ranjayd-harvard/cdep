"""Reusable Silver/Gold quality engine (AGENTS.md section 17).

Contract-driven: rules come from `SilverContract.quality.rules` /
`GoldDataProductContract.quality.rules`, never hard-coded per entity.
"""

from __future__ import annotations

from typing import Any

import sqlalchemy as sa
from sqlalchemy import Engine

from lakehouse.common.time import utcnow
from lakehouse.contracts.models import QualityRuleConfig
from lakehouse.quality.results import QualityRuleEvaluation
from lakehouse.quality.rules import evaluate_rule


def run_quality_rules(
    records: list[dict[str, Any]], rules: list[QualityRuleConfig]
) -> list[QualityRuleEvaluation]:
    total = len(records)
    results: list[QualityRuleEvaluation] = []
    for rule in rules:
        failed_indices = evaluate_rule(records, rule) if total else set()
        failed_count = len(failed_indices)
        failure_percentage = (failed_count / total * 100.0) if total else 0.0
        results.append(
            QualityRuleEvaluation(
                rule_name=rule.name,
                rule_type=rule.type,
                severity=rule.severity,
                total_count=total,
                failed_count=failed_count,
                failure_percentage=failure_percentage,
                passed=failed_count == 0,
                failed_indices=failed_indices,
            )
        )
    return results


def persist_quality_results(
    engine: Engine,
    *,
    pipeline_run_id: str,
    organization_id: str,
    tenant_id: str,
    layer: str,
    table_name: str,
    evaluations: list[QualityRuleEvaluation],
) -> None:
    """Persist to `lakehouse.quality_results` (AGENTS.md section 19). One
    row per rule evaluated, not one row per record."""
    if not evaluations:
        return
    now = utcnow()
    with engine.begin() as conn:
        conn.execute(
            sa.text(
                """
                INSERT INTO lakehouse.quality_results (
                    pipeline_run_id, organization_id, tenant_id, layer, table_name,
                    rule_name, severity, total_count, failed_count, failure_percentage,
                    passed, evaluated_at
                ) VALUES (
                    :pipeline_run_id, :organization_id, :tenant_id, :layer, :table_name,
                    :rule_name, :severity, :total_count, :failed_count, :failure_percentage,
                    :passed, :evaluated_at
                )
                """
            ),
            [
                {
                    "pipeline_run_id": pipeline_run_id,
                    "organization_id": organization_id,
                    "tenant_id": tenant_id,
                    "layer": layer,
                    "table_name": table_name,
                    "rule_name": e.rule_name,
                    "severity": e.severity,
                    "total_count": e.total_count,
                    "failed_count": e.failed_count,
                    "failure_percentage": e.failure_percentage,
                    "passed": e.passed,
                    "evaluated_at": now,
                }
                for e in evaluations
            ],
        )


def list_quality_results(engine: Engine, *, pipeline_run_id: str) -> list[dict]:
    with engine.connect() as conn:
        rows = (
            conn.execute(
                sa.text(
                    "SELECT * FROM lakehouse.quality_results WHERE pipeline_run_id = :id "
                    "ORDER BY evaluated_at"
                ),
                {"id": pipeline_run_id},
            )
            .mappings()
            .all()
        )
    return [dict(r) for r in rows]
