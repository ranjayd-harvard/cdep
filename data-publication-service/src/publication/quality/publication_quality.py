"""Publication quality gate (AGENTS.md section 27/52). Runs AFTER schema
projection but BEFORE the OUTBOUND exchange is created -- a failing
ERROR-severity rule means no READY outbound exchange gets created, full
stop (services/publication_service.py enforces this ordering).
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pyarrow as pa
import pyarrow.parquet as pq

from publication.models.artifact import ArtifactResult
from publication.models.contract import PublicationContract
from publication.quality.results import QualityDecision, QualityRuleResult


def evaluate_schema_match(table: pa.Table, contract: PublicationContract) -> QualityRuleResult:
    expected = {col.name for col in contract.published_schema}
    actual = set(table.column_names)
    passed = expected == actual
    return QualityRuleResult(
        rule_name="SCHEMA_MATCH", severity="ERROR", total_count=1, failed_count=0 if passed else 1, passed=passed
    )


def evaluate_tenant_scope_valid(
    rows: list[dict[str, Any]], *, organization_id: str, tenant_id: str, org_col: str, tenant_col: str
) -> QualityRuleResult:
    bad = [r for r in rows if r.get(org_col) != organization_id or r.get(tenant_col) != tenant_id]
    passed = len(bad) == 0
    return QualityRuleResult(
        rule_name="TENANT_SCOPE_VALID",
        severity="ERROR",
        total_count=len(rows),
        failed_count=len(bad),
        passed=passed,
    )


def evaluate_grain_unique(table: pa.Table, contract: PublicationContract) -> QualityRuleResult:
    if not contract.quality.enforce_grain or table.num_rows == 0:
        return QualityRuleResult(rule_name="GRAIN_UNIQUE", severity="ERROR", total_count=table.num_rows, failed_count=0, passed=True)

    key_columns = [table.column(k) for k in contract.grain]
    seen: set[tuple] = set()
    duplicate_count = 0
    for i in range(table.num_rows):
        key = tuple(col[i].as_py() for col in key_columns)
        if key in seen:
            duplicate_count += 1
        seen.add(key)
    passed = duplicate_count == 0
    return QualityRuleResult(
        rule_name="GRAIN_UNIQUE", severity="ERROR", total_count=table.num_rows, failed_count=duplicate_count, passed=passed
    )


def evaluate_artifact_non_empty(table: pa.Table, contract: PublicationContract) -> QualityRuleResult:
    if not contract.quality.require_non_empty:
        return QualityRuleResult(rule_name="ARTIFACT_NON_EMPTY", severity="ERROR", total_count=1, failed_count=0, passed=True)
    passed = table.num_rows > 0
    return QualityRuleResult(rule_name="ARTIFACT_NON_EMPTY", severity="ERROR", total_count=1, failed_count=0 if passed else 1, passed=passed)


def evaluate_record_count_match(table: pa.Table, *, expected_input_count: int, contract: PublicationContract) -> QualityRuleResult:
    if not contract.quality.verify_record_count:
        return QualityRuleResult(rule_name="RECORD_COUNT_MATCH", severity="WARNING", total_count=1, failed_count=0, passed=True)
    passed = table.num_rows == expected_input_count
    return QualityRuleResult(
        rule_name="RECORD_COUNT_MATCH",
        severity="ERROR",
        total_count=1,
        failed_count=0 if passed else 1,
        passed=passed,
    )


def evaluate_artifact_readable(artifact: ArtifactResult) -> QualityRuleResult:
    path = Path(artifact.local_path)
    try:
        if artifact.format == "PARQUET":
            readback = pq.read_table(path)
            passed = readback.num_rows == artifact.record_count
        else:
            passed = path.exists() and path.stat().st_size > 0
    except Exception:  # noqa: BLE001
        passed = False
    return QualityRuleResult(rule_name="ARTIFACT_READABLE", severity="ERROR", total_count=1, failed_count=0 if passed else 1, passed=passed)


def evaluate_publication_quality(
    *,
    rows: list[dict[str, Any]],
    projected_table: pa.Table,
    contract: PublicationContract,
    organization_id: str,
    tenant_id: str,
) -> QualityDecision:
    results = [
        evaluate_schema_match(projected_table, contract) if contract.quality.verify_schema else QualityRuleResult("SCHEMA_MATCH", "ERROR", 1, 0, True),
        evaluate_tenant_scope_valid(
            rows,
            organization_id=organization_id,
            tenant_id=tenant_id,
            org_col=contract.tenant_scope.organization_column,
            tenant_col=contract.tenant_scope.tenant_column,
        ),
        evaluate_grain_unique(projected_table, contract),
        evaluate_artifact_non_empty(projected_table, contract),
        evaluate_record_count_match(projected_table, expected_input_count=len(rows), contract=contract),
    ]
    return QualityDecision(results=results)
