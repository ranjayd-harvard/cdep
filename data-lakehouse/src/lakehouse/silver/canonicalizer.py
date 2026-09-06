"""Bronze row -> canonical Silver record (AGENTS.md sections 8/9/11).

Applies the configuration-driven mapping, then stamps technical lineage.
Never applies business-key-level deduplication or contract quality rules --
those are separate stages (`deduplicator.py`, `quality.py`) so each concern
stays independently testable.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any

from lakehouse.pipelines.pipeline_context import PipelineContext
from lakehouse.silver.lineage import attach_silver_lineage
from lakehouse.transformations.mapping import MappingConfig, apply_mapping


@dataclass
class CanonicalizationResult:
    record: dict[str, Any] | None
    bronze_row: dict[str, Any]
    error: str | None = None


def canonicalize_row(
    bronze_row: dict[str, Any],
    *,
    mapping: MappingConfig,
    context: PipelineContext,
    now: datetime,
) -> CanonicalizationResult:
    mapped = apply_mapping(bronze_row, mapping)
    if mapped.error:
        return CanonicalizationResult(record=None, bronze_row=bronze_row, error=mapped.error)

    canonical = attach_silver_lineage(mapped.record, bronze_row=bronze_row, context=context, now=now)
    return CanonicalizationResult(record=canonical, bronze_row=bronze_row)


def canonicalize_rows(
    bronze_rows: list[dict[str, Any]],
    *,
    mapping: MappingConfig,
    context: PipelineContext,
    now: datetime,
) -> tuple[list[tuple[dict[str, Any], dict[str, Any]]], list[CanonicalizationResult]]:
    """Returns (canonical_pairs, rejected_results). `canonical_pairs` keeps
    each canonical record paired with its source Bronze row so the
    deduplication stage can compare recency fields (e.g.
    `_source_received_at`) that don't survive onto the canonical shape."""
    canonical: list[tuple[dict[str, Any], dict[str, Any]]] = []
    rejected: list[CanonicalizationResult] = []
    for row in bronze_rows:
        result = canonicalize_row(row, mapping=mapping, context=context, now=now)
        if result.error:
            rejected.append(result)
        else:
            canonical.append((result.record, row))
    return canonical, rejected
