"""Contract-driven type coercion for business columns (AGENTS.md sections
20/21). Readers preserve raw source fidelity (CSV -> str, JSON/Parquet ->
native values); this module then coerces each *contract-declared* field to
its canonical type so bronze.<table> stays one schema-consistent table no
matter which format a given exchange arrived in.

A value that cannot be coerced is never silently dropped or defaulted -- the
caller is expected to route the failure into the reject/quarantine path
(AGENTS.md section 24).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import pyarrow as pa

from lakehouse.config.models import SchemaFieldConfig

CONTRACT_TYPE_TO_ARROW: dict[str, pa.DataType] = {
    "string": pa.string(),
    "long": pa.int64(),
    "int": pa.int64(),
    "double": pa.float64(),
    "float": pa.float64(),
    "boolean": pa.bool_(),
}


def _coerce_value(value: Any, contract_type: str) -> Any:
    if value is None or value == "":
        return None
    if contract_type == "string":
        return str(value)
    if contract_type in ("long", "int"):
        return int(value)
    if contract_type in ("double", "float"):
        return float(value)
    if contract_type == "boolean":
        if isinstance(value, bool):
            return value
        if isinstance(value, str):
            return value.strip().lower() in ("true", "1", "yes")
        return bool(value)
    return value


@dataclass
class CoercionResult:
    record: dict[str, Any] | None
    error: str | None = None


def coerce_business_record(
    record: dict[str, Any], fields: list[SchemaFieldConfig]
) -> CoercionResult:
    """Coerce every contract-declared field present in `fields`. Columns not
    declared in the contract (schema drift) pass through untouched."""
    declared = {f.name: f.type for f in fields}
    coerced = dict(record)
    for name, contract_type in declared.items():
        if name not in record:
            continue
        try:
            coerced[name] = _coerce_value(record[name], contract_type)
        except (ValueError, TypeError) as exc:
            return CoercionResult(
                record=None,
                error=f"Failed to coerce field '{name}'={record[name]!r} to '{contract_type}': {exc}",
            )
    return CoercionResult(record=coerced)
