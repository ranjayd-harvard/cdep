"""Tenant-scoped reads of Gold Data Products (AGENTS.md sections 26/60)."""

from __future__ import annotations

from typing import Any

from pyiceberg.catalog import Catalog

from lakehouse.catalog.iceberg import scan_tenant_scoped, scan_unscoped


def read_gold_tenant_scoped(
    catalog: Catalog, *, table_name: str, organization_id: str, tenant_id: str
) -> list[dict[str, Any]]:
    table = catalog.load_table(f"gold.{table_name}")
    return scan_tenant_scoped(
        table,
        organization_id=organization_id,
        tenant_id=tenant_id,
        org_column="organization_id",
        tenant_column="tenant_id",
    ).to_arrow().to_pylist()


def read_gold_admin(catalog: Catalog, *, table_name: str) -> list[dict[str, Any]]:
    """Privileged, cross-tenant read -- internal tooling only (AGENTS.md
    section 26)."""
    table = catalog.load_table(f"gold.{table_name}")
    return scan_unscoped(table).to_arrow().to_pylist()
