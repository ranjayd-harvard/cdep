"""Contract type strings -> PyArrow types. Kept separate from projection.py
so a new supported type is a one-line addition here."""

from __future__ import annotations

import re

import pyarrow as pa

from publication.common.errors import SchemaProjectionError

_DECIMAL_RE = re.compile(r"^decimal\((\d+),\s*(\d+)\)$")

_SIMPLE_TYPES: dict[str, pa.DataType] = {
    "string": pa.string(),
    "long": pa.int64(),
    "int": pa.int32(),
    "double": pa.float64(),
    "boolean": pa.bool_(),
    "date": pa.date32(),
    "timestamp": pa.timestamp("us"),
}


def contract_type_to_arrow(type_str: str) -> pa.DataType:
    if type_str in _SIMPLE_TYPES:
        return _SIMPLE_TYPES[type_str]

    match = _DECIMAL_RE.match(type_str)
    if match:
        precision, scale = int(match.group(1)), int(match.group(2))
        return pa.decimal128(precision, scale)

    raise SchemaProjectionError(f"Unsupported published column type '{type_str}'.")
