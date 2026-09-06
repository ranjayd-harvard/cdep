"""Catalog/table lifecycle helpers layered on top of PyIceberg.

Bronze tables are append-oriented (AGENTS.md section 25) and partitioned by
`_tenant_id` + `days(_ingested_at)` by default (section 27): this keeps
per-tenant, per-day scans cheap without over-partitioning by high-cardinality
`_exchange_id` or creating a directory-per-user layout.
"""

from __future__ import annotations

import pyarrow as pa
import structlog
from pyiceberg.catalog import Catalog
from pyiceberg.exceptions import NamespaceAlreadyExistsError, NoSuchTableError
from pyiceberg.expressions import And, BooleanExpression, EqualTo
from pyiceberg.table import DataScan, Table
from pyiceberg.transforms import DayTransform, IdentityTransform, MonthTransform

log = structlog.get_logger(__name__)

DEFAULT_PARTITION_FIELDS = ["_tenant_id", "_ingested_at"]


def ensure_namespace(catalog: Catalog, namespace: str) -> None:
    try:
        catalog.create_namespace(namespace)
    except NamespaceAlreadyExistsError:
        pass


def _apply_default_partitioning(table: Table) -> None:
    with table.update_spec() as update:
        update.add_field("_tenant_id", IdentityTransform())
        update.add_field("_ingested_at", DayTransform())


def apply_tenant_and_month_partitioning(tenant_column: str, date_column: str):
    """Partition function factory for Silver/Gold tables: `tenant_id`
    (identity) + `event_date` (month) -- AGENTS.md section 37. Avoids
    over-partitioning by high-cardinality event_id/exchange_id/ingestion_id.
    """

    def _apply(table: Table) -> None:
        with table.update_spec() as update:
            update.add_field(tenant_column, IdentityTransform())
            update.add_field(date_column, MonthTransform())

    return _apply


def get_or_create_table(
    catalog: Catalog,
    *,
    namespace: str,
    table_name: str,
    schema: pa.Schema,
    location: str | None = None,
    partition_fn=_apply_default_partitioning,
) -> Table:
    """`location`, when given, is an explicit per-table path (see
    `Settings.location_for_table`) so a newly-created table lands in its
    own namespace's bucket instead of defaulting to the catalog's single
    `warehouse` root -- without it, every namespace (bronze/silver/gold)
    would physically land under whichever bucket `warehouse` points at.

    `partition_fn` is only applied at table *creation* time (Iceberg
    partition specs are additive/evolvable, not retroactive) -- defaults to
    Bronze's `_tenant_id` + day(`_ingested_at`) scheme; Silver/Gold pass
    `apply_tenant_and_month_partitioning(...)` instead."""
    ensure_namespace(catalog, namespace)
    identifier = f"{namespace}.{table_name}"
    try:
        return catalog.load_table(identifier)
    except NoSuchTableError:
        log.info("catalog.table.create", table=identifier, location=location)
        table = catalog.create_table(identifier, schema=schema, location=location)
        partition_fn(table)
        return catalog.load_table(identifier)


def reconcile_schema(table: Table, incoming_schema: pa.Schema, *, mode: str) -> Table:
    """Evolve the Iceberg table schema to include any new, additive
    columns from `incoming_schema` (PERMISSIVE mode only). STRICT-mode
    rejection already happened earlier via bronze.schema.enforce_schema_mode
    against the data contract; this only reconciles the physical Iceberg
    schema so `append()` does not fail on a widened Arrow schema."""
    current_names = {f.name for f in table.schema().fields}
    incoming_names = {f.name for f in incoming_schema}
    if incoming_names - current_names and mode == "PERMISSIVE":
        log.info(
            "bronze.schema.evolve",
            table=".".join(table.name()),
            new_columns=sorted(incoming_names - current_names),
        )
        with table.update_schema() as update:
            update.union_by_name(incoming_schema)
    return table


def tenant_scoped_filter(
    organization_id: str,
    tenant_id: str,
    *,
    org_column: str = "_organization_id",
    tenant_column: str = "_tenant_id",
) -> BooleanExpression:
    """The one sanctioned way to build a tenant row filter (AGENTS.md
    section 26). Never interpolate organization_id/tenant_id into a raw SQL
    or filter string -- always go through this helper.

    Defaults to Bronze's `_organization_id`/`_tenant_id` technical lineage
    columns. Silver/Gold tables carry `organization_id`/`tenant_id` as
    unprefixed, first-class canonical columns instead (AGENTS.md sections
    8/29) -- pass `org_column="organization_id", tenant_column="tenant_id"`
    for those."""
    return And(
        EqualTo(org_column, organization_id),
        EqualTo(tenant_column, tenant_id),
    )


def scan_tenant_scoped(
    table: Table,
    *,
    organization_id: str,
    tenant_id: str,
    org_column: str = "_organization_id",
    tenant_column: str = "_tenant_id",
) -> DataScan:
    """GOOD: `WHERE <org_column> = ? AND <tenant_column> = ?`. Customer-scoped
    callers must use this, never `table.scan()` unfiltered -- see
    `scan_unscoped` for the explicitly-named privileged alternative."""
    return table.scan(
        row_filter=tenant_scoped_filter(
            organization_id, tenant_id, org_column=org_column, tenant_column=tenant_column
        )
    )


def scan_unscoped(table: Table) -> DataScan:
    """BAD for customer-scoped operations -- `SELECT * FROM bronze.*` across
    every tenant. Reserved for privileged internal platform workloads only
    (AGENTS.md section 26), e.g. reconciliation or cross-tenant admin
    tooling. Callers must justify use of this at the call site."""
    return table.scan()


def ingestion_scoped_filter(
    organization_id: str, tenant_id: str, ingestion_id: str
) -> BooleanExpression:
    """Scope a Bronze read to exactly one ingestion batch (AGENTS.md Phase 3
    section 33) -- Bronze->Silver must never blindly scan the whole table."""
    return And(
        tenant_scoped_filter(organization_id, tenant_id),
        EqualTo("_ingestion_id", ingestion_id),
    )


def scan_ingestion_scoped(
    table: Table, *, organization_id: str, tenant_id: str, ingestion_id: str
) -> DataScan:
    return table.scan(
        row_filter=ingestion_scoped_filter(organization_id, tenant_id, ingestion_id)
    )


def pipeline_run_scoped_filter(
    organization_id: str, tenant_id: str, pipeline_run_id: str
) -> BooleanExpression:
    """Scope a Silver read to rows written/updated by exactly one
    Bronze->Silver pipeline run -- this is what lets Silver->Gold process
    incrementally (AGENTS.md section 27) instead of rebuilding all tenant
    history on every Bronze ingestion. Silver tables use unprefixed
    `organization_id`/`tenant_id` columns (AGENTS.md section 8)."""
    return And(
        tenant_scoped_filter(
            organization_id, tenant_id, org_column="organization_id", tenant_column="tenant_id"
        ),
        EqualTo("pipeline_run_id", pipeline_run_id),
    )


def scan_pipeline_run_scoped(
    table: Table, *, organization_id: str, tenant_id: str, pipeline_run_id: str
) -> DataScan:
    return table.scan(
        row_filter=pipeline_run_scoped_filter(organization_id, tenant_id, pipeline_run_id)
    )
