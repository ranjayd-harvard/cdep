"""Customer-safe schema projection (AGENTS.md sections 5/8/18/29).

Sequence enforced by the caller (services/publication_service.py):

    Gold rows (tenant-scoped, snapshot-pinned, cross-tenant-asserted)
        -> project_published_schema()   [THIS MODULE]
        -> apply_masking()
        -> export

This is the ONLY place columns are selected for the customer artifact --
internal fields (organization_id, tenant_id, _gold_pipeline_run_id,
_product_id, etc.) are dropped simply by never being copied into the
output table, not by an explicit "drop these" blocklist. A contract that
never lists a given internal column can never leak it.
"""

from __future__ import annotations

from typing import Any

import pyarrow as pa

from publication.common.errors import SchemaProjectionError
from publication.models.contract import PublicationContract
from publication.transformations.aliases import contract_type_to_arrow


def project_published_schema(rows: list[dict[str, Any]], contract: PublicationContract) -> pa.Table:
    target_fields = [
        pa.field(col.name, contract_type_to_arrow(col.type), nullable=not col.required)
        for col in contract.published_schema
    ]
    target_schema = pa.schema(target_fields)

    projected_rows = []
    for row in rows:
        projected = {}
        for col in contract.published_schema:
            if col.source not in row:
                if col.required:
                    raise SchemaProjectionError(
                        f"Required published column '{col.name}' has no source column "
                        f"'{col.source}' in the Gold row."
                    )
                projected[col.name] = None
            else:
                projected[col.name] = row[col.source]
            if col.required and projected[col.name] is None:
                raise SchemaProjectionError(
                    f"Required published column '{col.name}' is null in a Gold row."
                )
        projected_rows.append(projected)

    try:
        return pa.Table.from_pylist(projected_rows, schema=target_schema)
    except (pa.ArrowInvalid, pa.ArrowTypeError) as exc:
        raise SchemaProjectionError(f"Failed to project rows onto published schema: {exc}") from exc


def assert_no_unauthorized_columns(table: pa.Table, contract: PublicationContract) -> None:
    """AGENTS.md section 27: "No unauthorized columns exist". Belt-and-
    suspenders check -- project_published_schema() already builds the
    output table from the contract's column list alone, so this can only
    fail if a future refactor changes that invariant."""
    allowed = {col.name for col in contract.published_schema}
    actual = set(table.column_names)
    unauthorized = actual - allowed
    if unauthorized:
        raise SchemaProjectionError(f"Unauthorized column(s) present in published output: {sorted(unauthorized)}")
