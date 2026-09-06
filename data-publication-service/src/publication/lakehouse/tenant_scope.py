"""TenantScopedGoldReader (AGENTS.md sections 9/28/29): the ONLY sanctioned
way publication code reads Gold. Requires organization_id + tenant_id,
pins the read to an exact snapshot, and enforces the mandatory
cross-tenant safety assertion before returning any rows to the caller.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from pyiceberg.catalog import Catalog
from pyiceberg.expressions import And, EqualTo

from publication.common.errors import CrossTenantSafetyError, MissingTenantContextError
from publication.lakehouse.iceberg_reader import load_gold_table, resolve_snapshot_id
from publication.models.contract import PublicationContract
from publication.models.gold_ready import GoldReadyContext


@dataclass
class ScopedGoldRead:
    rows: list[dict[str, Any]]
    resolved_snapshot_id: int
    input_record_count: int


class TenantScopedGoldReader:
    """Normal publication operations MUST go through this class. There is
    deliberately no "read everything, filter in Python" fallback here --
    the row_filter is pushed into the Iceberg scan itself."""

    def __init__(self, catalog: Catalog) -> None:
        self._catalog = catalog

    def read(
        self,
        *,
        gold_ready: GoldReadyContext,
        contract: PublicationContract,
    ) -> ScopedGoldRead:
        if not gold_ready.organization_id or not gold_ready.tenant_id:
            raise MissingTenantContextError(
                "No organization_id/tenant_id supplied -- refusing to read Gold. "
                "Internal platform-admin reads must use a separate, explicit mode "
                "(AGENTS.md section 9), never this reader."
            )

        table = load_gold_table(self._catalog, table_name=contract.source_table_name)
        snapshot_id = resolve_snapshot_id(table, requested_snapshot_id=gold_ready.gold_snapshot_id)

        org_col = contract.tenant_scope.organization_column
        tenant_col = contract.tenant_scope.tenant_column
        row_filter = And(
            EqualTo(org_col, gold_ready.organization_id),
            EqualTo(tenant_col, gold_ready.tenant_id),
        )

        scan = table.scan(row_filter=row_filter, snapshot_id=snapshot_id)
        rows = scan.to_arrow().to_pylist()

        assert_cross_tenant_safety(
            rows,
            organization_id=gold_ready.organization_id,
            tenant_id=gold_ready.tenant_id,
            org_col=org_col,
            tenant_col=tenant_col,
        )

        return ScopedGoldRead(rows=rows, resolved_snapshot_id=snapshot_id, input_record_count=len(rows))


def assert_cross_tenant_safety(
    rows: list[dict[str, Any]],
    *,
    organization_id: str,
    tenant_id: str,
    org_col: str,
    tenant_col: str,
) -> None:
    """Mandatory cross-tenant safety check (AGENTS.md section 28). Runs
    even though the scan above already pushed down an equality filter --
    this defends against a filter pushdown bug, a catalog misconfiguration,
    or a future refactor that loosens the filter, not just against "trust
    the query planner did the right thing"."""
    if not rows:
        return  # AGENTS.md section 27 (non-empty check) is a separate, later gate.

    orgs = {r.get(org_col) for r in rows}
    tenants = {r.get(tenant_col) for r in rows}

    if orgs != {organization_id} or tenants != {tenant_id}:
        raise CrossTenantSafetyError(
            f"Cross-tenant safety assertion failed: expected exactly "
            f"organization_id={organization_id!r} tenant_id={tenant_id!r} but scan returned "
            f"organization_id(s)={orgs!r} tenant_id(s)={tenants!r}. Aborting publication -- "
            f"this must never produce a customer artifact."
        )
