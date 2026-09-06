"""Quality rule implementations (AGENTS.md section 17).

Each rule function takes the full record list and a `QualityRuleConfig`, and
returns the set of record indices that *fail* the rule -- this lets Silver
quarantine exactly the offending rows rather than the whole batch.
"""

from __future__ import annotations

import re
from typing import Any

from lakehouse.contracts.models import QualityRuleConfig


def _not_null(records: list[dict[str, Any]], column: str, _value: Any) -> set[int]:
    return {i for i, r in enumerate(records) if r.get(column) is None}


def _unique(records: list[dict[str, Any]], column: str, _value: Any) -> set[int]:
    seen: dict[Any, int] = {}
    failing: set[int] = set()
    for i, r in enumerate(records):
        value = r.get(column)
        if value is None:
            continue
        if value in seen:
            failing.add(i)
            failing.add(seen[value])
        else:
            seen[value] = i
    return failing


def _min(records: list[dict[str, Any]], column: str, value: Any) -> set[int]:
    threshold = float(value)
    return {
        i
        for i, r in enumerate(records)
        if r.get(column) is not None and float(r[column]) < threshold
    }


def _max(records: list[dict[str, Any]], column: str, value: Any) -> set[int]:
    threshold = float(value)
    return {
        i
        for i, r in enumerate(records)
        if r.get(column) is not None and float(r[column]) > threshold
    }


def _allowed_values(records: list[dict[str, Any]], column: str, value: Any) -> set[int]:
    allowed = set(value or [])
    return {
        i for i, r in enumerate(records) if r.get(column) is not None and r[column] not in allowed
    }


def _regex(records: list[dict[str, Any]], column: str, value: Any) -> set[int]:
    pattern = re.compile(str(value))
    return {
        i
        for i, r in enumerate(records)
        if r.get(column) is not None and not pattern.match(str(r[column]))
    }


def _date_range(records: list[dict[str, Any]], column: str, value: Any) -> set[int]:
    from datetime import date

    min_v = date.fromisoformat(value["min"]) if value and value.get("min") else None
    max_v = date.fromisoformat(value["max"]) if value and value.get("max") else None
    failing: set[int] = set()
    for i, r in enumerate(records):
        v = r.get(column)
        if v is None:
            continue
        if min_v and v < min_v:
            failing.add(i)
        if max_v and v > max_v:
            failing.add(i)
    return failing


RULE_IMPLEMENTATIONS = {
    "not_null": _not_null,
    "unique": _unique,
    "min": _min,
    "max": _max,
    "allowed_values": _allowed_values,
    "regex": _regex,
    "date_range": _date_range,
}


def evaluate_rule(records: list[dict[str, Any]], rule: QualityRuleConfig) -> set[int]:
    try:
        impl = RULE_IMPLEMENTATIONS[rule.type]
    except KeyError:
        raise ValueError(f"Unknown quality rule type '{rule.type}'") from None
    return impl(records, rule.column, rule.value)
