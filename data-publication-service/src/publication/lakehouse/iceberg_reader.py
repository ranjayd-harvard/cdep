"""Iceberg catalog access (AGENTS.md sections 3/10).

Uses the exact same PyIceberg SQL-catalog pattern as
data-lakehouse's `lakehouse.catalog.catalog.build_catalog` -- this service
points at the *same* Postgres-backed catalog and MinIO/S3 warehouse the
lakehouse itself writes to, but only ever opens read-only scans against the
`gold` namespace. It never creates, writes, or evolves a table.

Deviation from AGENTS.md section 3 ("Use PySpark"): the actual
data-lakehouse implementation (Phase 2/3, already built and verified) uses
PyIceberg + PyArrow directly, with no Spark cluster anywhere in the stack.
Per the "adapt to the existing Phase 1-3 implementation, minor changes are
acceptable" guidance, this service matches that -- introducing Spark here
would mean two incompatible Iceberg write/read paths for the same tables.
"""

from __future__ import annotations

from functools import lru_cache

from pyiceberg.catalog import Catalog
from pyiceberg.catalog.sql import SqlCatalog
from pyiceberg.table import Table

from publication.config.settings import Settings, get_settings


def build_catalog(settings: Settings) -> Catalog:
    properties = {
        "uri": settings.lakehouse_catalog_uri,
        "warehouse": settings.lakehouse_warehouse,
        "s3.endpoint": settings.lakehouse_s3_endpoint,
        "s3.access-key-id": settings.lakehouse_s3_access_key,
        "s3.secret-access-key": settings.lakehouse_s3_secret_key,
        "s3.region": settings.lakehouse_s3_region,
        "s3.force-virtual-addressing": "false",
    }
    return SqlCatalog(settings.lakehouse_catalog_name, **properties)


@lru_cache
def get_catalog() -> Catalog:
    return build_catalog(get_settings())


def load_gold_table(catalog: Catalog, *, table_name: str) -> Table:
    return catalog.load_table(f"gold.{table_name}")


def resolve_snapshot_id(table: Table, *, requested_snapshot_id: str | None) -> int:
    """Resolve the exact snapshot to read from (AGENTS.md section 10):
    prefer the snapshot GoldReady named; fall back to the table's current
    snapshot only when none was given (e.g. ad-hoc/admin tooling)."""
    from publication.common.errors import GoldSnapshotNotFoundError

    if requested_snapshot_id is None:
        current = table.current_snapshot()
        if current is None:
            raise GoldSnapshotNotFoundError(f"Table {table.name()} has no snapshots yet.")
        return current.snapshot_id

    try:
        requested_int = int(requested_snapshot_id)
    except ValueError as exc:
        raise GoldSnapshotNotFoundError(f"Invalid snapshot id '{requested_snapshot_id}'.") from exc

    known_ids = {s.snapshot_id for s in table.snapshots()}
    if requested_int not in known_ids:
        raise GoldSnapshotNotFoundError(
            f"Snapshot '{requested_snapshot_id}' does not exist on table {table.name()}. "
            f"GoldReady referenced a snapshot this table has never had (or it was expired "
            f"by table maintenance)."
        )
    return requested_int
