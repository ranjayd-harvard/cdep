"""Business-key deduplication (AGENTS.md section 13).

Strategy: among records sharing the same tenant-scoped business key, keep
the one with the greatest `order_by` value (default: the Bronze row's
`_source_received_at`, i.e. "latest source received timestamp wins"),
falling back to `tiebreaker` (`_ingested_at`) when `order_by` is equal or
missing. Never compares records across different tenants -- the business
key itself always includes `organization_id`/`tenant_id`.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

_MIN_DATETIME = datetime.min.replace(tzinfo=timezone.utc)


def _sort_key(bronze_row: dict[str, Any], order_by: str, tiebreaker: str) -> tuple:
    def _value(field: str):
        v = bronze_row.get(field)
        if v is None:
            return _MIN_DATETIME
        if isinstance(v, datetime) and v.tzinfo is None:
            return v.replace(tzinfo=timezone.utc)
        return v

    return (_value(order_by), _value(tiebreaker))


def deduplicate(
    pairs: list[tuple[dict[str, Any], dict[str, Any]]],
    *,
    business_key: list[str],
    order_by: str,
    tiebreaker: str,
) -> tuple[list[dict[str, Any]], int]:
    """`pairs` are (canonical_record, source_bronze_row) tuples. Returns
    (kept_canonical_records, dropped_duplicate_count)."""
    best: dict[tuple, tuple[dict[str, Any], tuple]] = {}
    for canonical, bronze_row in pairs:
        key = tuple(canonical.get(k) for k in business_key)
        rank = _sort_key(bronze_row, order_by, tiebreaker)
        current = best.get(key)
        if current is None or rank >= current[1]:
            best[key] = (canonical, rank)

    kept = [record for record, _ in best.values()]
    dropped = len(pairs) - len(kept)
    return kept, dropped
