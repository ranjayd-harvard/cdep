"""Iceberg catalog access.

Uses the exact same PyIceberg SQL-catalog pattern as
data-publication-service's `publication.lakehouse.iceberg_reader` -- this
service points at the *same* Postgres-backed catalog and MinIO/S3 warehouse
data-lakehouse itself writes to, and only ever opens read-only scans
against the `gold` namespace.

Deviation from data-publication-service's `TenantScopedGoldReader`: that
reader is single-tenant-per-call (one publication = one tenant), pushing an
`EqualTo(org)/EqualTo(tenant)` filter into the scan. Serving projection
instead runs a full-catalog scan across *all* tenants in one pass -- the
whole point of the serving store is to hold every tenant's rows at once so
tenant isolation can live at query time (data-product-api-service, which
scopes every query by organization_id+tenant_id) rather than at read time.
This is legitimate here because the projector is trusted internal ETL that
never returns rows to a customer directly -- it only ever writes them into
the serving store, from which the customer-facing API reads with its own,
separate tenant-scoping (see `serving_store/repository.py`).
"""

from __future__ import annotations

from functools import lru_cache

from pyiceberg.catalog import Catalog
from pyiceberg.catalog.sql import SqlCatalog
from pyiceberg.table import Table

from serving_projection.config.settings import Settings, get_settings


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


def current_snapshot_id(table: Table) -> int:
    from serving_projection.common.errors import GoldSnapshotNotFoundError

    current = table.current_snapshot()
    if current is None:
        raise GoldSnapshotNotFoundError(f"Table {table.name()} has no snapshots yet.")
    return current.snapshot_id
