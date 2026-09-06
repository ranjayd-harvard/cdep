from __future__ import annotations

import pyarrow as pa
from pyiceberg.catalog import Catalog
from pyiceberg.table import Table

from lakehouse.catalog.iceberg import get_or_create_table, reconcile_schema
from lakehouse.config.models import BronzeTargetConfig
from lakehouse.config.settings import Settings


def resolve_bronze_table(
    catalog: Catalog,
    *,
    target: BronzeTargetConfig,
    schema: pa.Schema,
    schema_mode: str,
    settings: Settings,
) -> Table:
    location = settings.location_for_table(target.namespace, target.table)
    table = get_or_create_table(
        catalog,
        namespace=target.namespace,
        table_name=target.table,
        schema=schema,
        location=location,
    )
    return reconcile_schema(table, schema, mode=schema_mode)


def qualified_name(target: BronzeTargetConfig) -> str:
    return f"{target.namespace}.{target.table}"
