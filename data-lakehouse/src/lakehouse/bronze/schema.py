"""Bronze schema construction and drift detection (AGENTS.md section 22).

Business columns are always typed as `string` for CSV/JSON sources -- Bronze
does not infer or coerce types (section 20). Parquet sources keep their
native Arrow types since the format itself is already typed.
"""

from __future__ import annotations

import pyarrow as pa

from lakehouse.bronze.coercion import CONTRACT_TYPE_TO_ARROW
from lakehouse.common.errors import SchemaValidationError
from lakehouse.config.models import SchemaFieldConfig

METADATA_ARROW_FIELDS: list[pa.Field] = [
    pa.field("_organization_id", pa.string(), nullable=False),
    pa.field("_tenant_id", pa.string(), nullable=False),
    pa.field("_exchange_id", pa.string(), nullable=False),
    pa.field("_ingestion_id", pa.string(), nullable=False),
    pa.field("_data_product_id", pa.string(), nullable=False),
    pa.field("_schema_version", pa.string(), nullable=False),
    pa.field("_source_file", pa.string(), nullable=False),
    pa.field("_source_path", pa.string(), nullable=False),
    pa.field("_source_format", pa.string(), nullable=False),
    pa.field("_source_received_at", pa.timestamp("us"), nullable=True),
    pa.field("_ingested_at", pa.timestamp("us"), nullable=False),
    pa.field("_source_row_number", pa.int64(), nullable=True),
    pa.field("_record_hash", pa.string(), nullable=True),
    pa.field("_source_system", pa.string(), nullable=True),
    pa.field("_source_channel", pa.string(), nullable=True),
]

METADATA_COLUMN_NAMES = {f.name for f in METADATA_ARROW_FIELDS}


def build_bronze_schema(
    business_columns: list[str],
    *,
    contract_fields: list[SchemaFieldConfig] | None = None,
    native_fields: list[pa.Field] | None = None,
) -> pa.Schema:
    """Build the target Arrow schema for a Bronze table.

    Business column types come from (in priority order):
    1. The data contract's declared canonical type (`contract_fields`) --
       this is what keeps the same logical table schema-consistent across
       CSV/JSON/Parquet ingestions of the same data product.
    2. `native_fields` (typed source, e.g. a column Parquet carries that the
       contract doesn't declare).
    3. `string`, for anything else -- source-faithful default (section 20).
    """
    declared = {f.name: f.type for f in (contract_fields or [])}
    native = {f.name: f.type for f in (native_fields or []) if f.name not in METADATA_COLUMN_NAMES}

    business_fields = []
    for name in business_columns:
        if name in declared:
            arrow_type = CONTRACT_TYPE_TO_ARROW.get(declared[name], pa.string())
        elif name in native:
            arrow_type = native[name]
        else:
            arrow_type = pa.string()
        business_fields.append(pa.field(name, arrow_type, nullable=True))

    return pa.schema(business_fields + METADATA_ARROW_FIELDS)


def detect_schema_drift(observed_columns: list[str], expected_field_names: list[str]) -> dict:
    observed = set(observed_columns)
    expected = set(expected_field_names)
    return {
        "new_columns": sorted(observed - expected),
        "missing_columns": sorted(expected - observed),
    }


def enforce_schema_mode(
    mode: str, drift: dict, *, data_product_id: str
) -> None:
    """STRICT: any drift fails ingestion. PERMISSIVE: additive (new) columns
    are allowed; missing *required* columns still fail upstream via
    technical validation, not here."""
    if mode == "STRICT" and (drift["new_columns"] or drift["missing_columns"]):
        raise SchemaValidationError(
            f"Schema drift detected for '{data_product_id}' under STRICT mode: {drift}"
        )
