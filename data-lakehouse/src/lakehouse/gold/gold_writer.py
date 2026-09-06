"""Gold Iceberg write path: incremental MERGE/upsert (AGENTS.md sections
27/28/36) -- same `Table.upsert()` mechanism as Silver, keyed on the
contract's declared grain (`keys`), so a Bronze update to one event only
touches that event's Gold row.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import pyarrow as pa
import structlog
from pyiceberg.catalog import Catalog
from pyiceberg.table import Table

from lakehouse.catalog.iceberg import (
    apply_tenant_and_month_partitioning,
    get_or_create_table,
    scan_tenant_scoped,
)
from lakehouse.common.errors import GoldWriteError
from lakehouse.config.settings import Settings
from lakehouse.contracts.models import GoldDataProductContract

log = structlog.get_logger(__name__)


@dataclass
class GoldWriteResult:
    gold_table: str
    record_count: int
    target_snapshot_id: str | None


def resolve_gold_table(
    catalog: Catalog,
    *,
    table_name: str,
    schema: pa.Schema,
    settings: Settings,
    date_column: str,
) -> Table:
    location = settings.location_for_table("gold", table_name)
    partition_fn = apply_tenant_and_month_partitioning("tenant_id", date_column)
    return get_or_create_table(
        catalog,
        namespace="gold",
        table_name=table_name,
        schema=schema,
        location=location,
        partition_fn=partition_fn,
    )


def _preserve_created_at(
    table: Table,
    records: list[dict[str, Any]],
    *,
    grain_key: list[str],
    organization_id: str,
    tenant_id: str,
) -> None:
    if table.current_snapshot() is None:
        return
    existing = scan_tenant_scoped(
        table,
        organization_id=organization_id,
        tenant_id=tenant_id,
        org_column="organization_id",
        tenant_column="tenant_id",
    ).to_arrow().to_pylist()
    existing_created_at = {
        tuple(row[k] for k in grain_key): row["_created_at"] for row in existing
    }
    for record in records:
        key = tuple(record[k] for k in grain_key)
        if key in existing_created_at:
            record["_created_at"] = existing_created_at[key]


def write_gold(
    catalog: Catalog,
    *,
    contract: GoldDataProductContract,
    table_name: str,
    schema: pa.Schema,
    date_column: str,
    product_records: list[dict[str, Any]],
    settings: Settings,
) -> GoldWriteResult:
    qualified_name = f"gold.{table_name}"
    table = resolve_gold_table(
        catalog, table_name=table_name, schema=schema, settings=settings, date_column=date_column
    )

    if not product_records:
        snapshot = table.current_snapshot()
        return GoldWriteResult(
            gold_table=qualified_name,
            record_count=0,
            target_snapshot_id=str(snapshot.snapshot_id) if snapshot else None,
        )

    organization_id = product_records[0]["organization_id"]
    tenant_id = product_records[0]["tenant_id"]
    _preserve_created_at(
        table,
        product_records,
        grain_key=contract.keys,
        organization_id=organization_id,
        tenant_id=tenant_id,
    )

    try:
        arrow_table = pa.Table.from_pylist(product_records, schema=schema)
        aligned = arrow_table.select(list(table.schema().as_arrow().names))
        table.upsert(aligned, join_cols=contract.keys)
    except Exception as exc:  # noqa: BLE001 - convert to a stable error code
        raise GoldWriteError(f"Gold upsert failed for '{qualified_name}': {exc}") from exc

    table.refresh()
    snapshot = table.current_snapshot()
    log.info(
        "gold.write.completed",
        table=qualified_name,
        record_count=len(product_records),
        target_snapshot_id=snapshot.snapshot_id if snapshot else None,
    )
    return GoldWriteResult(
        gold_table=qualified_name,
        record_count=len(product_records),
        target_snapshot_id=str(snapshot.snapshot_id) if snapshot else None,
    )
