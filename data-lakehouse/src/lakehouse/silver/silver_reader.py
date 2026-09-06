"""Tenant/pipeline-run-scoped reads of Silver tables (AGENTS.md sections
27/33). Silver->Gold reads only the rows a given Bronze->Silver run just
wrote/updated -- never the whole tenant history -- so Gold stays
incremental.
"""

from __future__ import annotations

from typing import Any

from pyiceberg.catalog import Catalog

from lakehouse.catalog.iceberg import scan_pipeline_run_scoped, scan_tenant_scoped


def read_silver_pipeline_run_scoped(
    catalog: Catalog,
    *,
    table_name: str,
    organization_id: str,
    tenant_id: str,
    pipeline_run_id: str,
) -> list[dict[str, Any]]:
    table = catalog.load_table(f"silver.{table_name}")
    return scan_pipeline_run_scoped(
        table,
        organization_id=organization_id,
        tenant_id=tenant_id,
        pipeline_run_id=pipeline_run_id,
    ).to_arrow().to_pylist()


def read_silver_tenant_scoped(
    catalog: Catalog, *, table_name: str, organization_id: str, tenant_id: str
) -> list[dict[str, Any]]:
    table = catalog.load_table(f"silver.{table_name}")
    return scan_tenant_scoped(
        table,
        organization_id=organization_id,
        tenant_id=tenant_id,
        org_column="organization_id",
        tenant_column="tenant_id",
    ).to_arrow().to_pylist()
