"""Bulk (all-tenant) Gold reads for serving projection (spec §8.4).

Full refresh reads the entire `gold.event_performance` table at its current
snapshot. Incremental refresh pushes a `_updated_at > checkpoint` predicate
into the Iceberg scan itself -- real column, real filter, not faked CDC
(Gold's `_updated_at` is written by every Silver->Gold run, see
data-lakehouse/src/lakehouse/gold/products/event_performance.py's schema).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any

from pyiceberg.catalog import Catalog
from pyiceberg.expressions import GreaterThan

from serving_projection.lakehouse.iceberg_reader import current_snapshot_id, load_gold_table


@dataclass
class BulkGoldRead:
    rows: list[dict[str, Any]]
    resolved_snapshot_id: int
    input_record_count: int


def read_full(catalog: Catalog, *, table_name: str) -> BulkGoldRead:
    table = load_gold_table(catalog, table_name=table_name)
    snapshot_id = current_snapshot_id(table)
    rows = table.scan(snapshot_id=snapshot_id).to_arrow().to_pylist()
    return BulkGoldRead(rows=rows, resolved_snapshot_id=snapshot_id, input_record_count=len(rows))


def read_incremental(catalog: Catalog, *, table_name: str, updated_since: datetime) -> BulkGoldRead:
    table = load_gold_table(catalog, table_name=table_name)
    snapshot_id = current_snapshot_id(table)
    row_filter = GreaterThan("_updated_at", updated_since)
    rows = table.scan(row_filter=row_filter, snapshot_id=snapshot_id).to_arrow().to_pylist()
    return BulkGoldRead(rows=rows, resolved_snapshot_id=snapshot_id, input_record_count=len(rows))
