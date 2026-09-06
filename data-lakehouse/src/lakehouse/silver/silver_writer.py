"""Silver Iceberg write path: incremental MERGE/upsert (AGENTS.md sections
14/36). Never rebuilds the whole table -- `Table.upsert()` performs a real
Iceberg merge (join on the business key, update matched rows, insert new
ones) using PyIceberg's native upsert support.
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
from lakehouse.common.errors import SilverWriteError
from lakehouse.config.settings import Settings
from lakehouse.contracts.models import SilverContract

log = structlog.get_logger(__name__)


@dataclass
class SilverWriteResult:
    silver_table: str
    record_count: int
    target_snapshot_id: str | None


def resolve_silver_table(
    catalog: Catalog,
    *,
    table_name: str,
    schema: pa.Schema,
    settings: Settings,
    date_column: str,
) -> Table:
    location = settings.location_for_table("silver", table_name)
    partition_fn = apply_tenant_and_month_partitioning("tenant_id", date_column)
    return get_or_create_table(
        catalog,
        namespace="silver",
        table_name=table_name,
        schema=schema,
        location=location,
        partition_fn=partition_fn,
    )


def _preserve_created_at(
    table: Table,
    records: list[dict[str, Any]],
    *,
    business_key: list[str],
    organization_id: str,
    tenant_id: str,
) -> None:
    """A MERGE's `when_matched_update_all` would otherwise overwrite
    `silver_created_at` with "now" on every update -- look up the existing
    value per business key first so updates preserve original creation time
    (AGENTS.md section 15: "preserve enough lineage to audit changes")."""
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
        tuple(row[k] for k in business_key): row["silver_created_at"] for row in existing
    }
    for record in records:
        key = tuple(record[k] for k in business_key)
        if key in existing_created_at:
            record["silver_created_at"] = existing_created_at[key]


def write_silver(
    catalog: Catalog,
    *,
    contract: SilverContract,
    table_name: str,
    schema: pa.Schema,
    date_column: str,
    canonical_records: list[dict[str, Any]],
    settings: Settings,
) -> SilverWriteResult:
    qualified_name = f"silver.{table_name}"
    table = resolve_silver_table(
        catalog, table_name=table_name, schema=schema, settings=settings, date_column=date_column
    )

    if not canonical_records:
        snapshot = table.current_snapshot()
        return SilverWriteResult(
            silver_table=qualified_name,
            record_count=0,
            target_snapshot_id=str(snapshot.snapshot_id) if snapshot else None,
        )

    organization_id = canonical_records[0]["organization_id"]
    tenant_id = canonical_records[0]["tenant_id"]
    _preserve_created_at(
        table,
        canonical_records,
        business_key=contract.business_key,
        organization_id=organization_id,
        tenant_id=tenant_id,
    )

    try:
        arrow_table = pa.Table.from_pylist(canonical_records, schema=schema)
        aligned = arrow_table.select(list(table.schema().as_arrow().names))
        table.upsert(aligned, join_cols=contract.business_key)
    except Exception as exc:  # noqa: BLE001 - convert to a stable error code
        raise SilverWriteError(f"Silver upsert failed for '{qualified_name}': {exc}") from exc

    table.refresh()
    snapshot = table.current_snapshot()
    log.info(
        "silver.write.completed",
        table=qualified_name,
        record_count=len(canonical_records),
        target_snapshot_id=snapshot.snapshot_id if snapshot else None,
    )
    return SilverWriteResult(
        silver_table=qualified_name,
        record_count=len(canonical_records),
        target_snapshot_id=str(snapshot.snapshot_id) if snapshot else None,
    )
