"""Lightweight PII/column masking extension point (AGENTS.md section 30).

Deliberately small: two strategies, applied to one Arrow column at a time.
No masking is configured for `event-performance` -- this exists so a
future contract can add:

    masking:
      email:
        strategy: redact
      account_number:
        strategy: last4
"""

from __future__ import annotations

import hashlib

import pyarrow as pa
import pyarrow.compute as pc

from publication.common.errors import SchemaProjectionError
from publication.models.contract import MaskingRule


def apply_masking(table: pa.Table, masking: dict[str, MaskingRule]) -> pa.Table:
    if not masking:
        return table

    for column_name, rule in masking.items():
        if column_name not in table.column_names:
            continue  # column not published at all -- nothing to mask
        column = table.column(column_name)
        masked = _apply_strategy(column, rule.strategy)
        table = table.set_column(table.column_names.index(column_name), column_name, masked)
    return table


def _apply_strategy(column: pa.ChunkedArray, strategy: str) -> pa.ChunkedArray:
    if strategy == "redact":
        return pc.if_else(pc.is_null(column), column, pa.scalar("***REDACTED***"))

    if strategy == "hash":
        values = column.to_pylist()
        hashed = [None if v is None else hashlib.sha256(str(v).encode("utf-8")).hexdigest() for v in values]
        return pa.chunked_array([pa.array(hashed, type=pa.string())])

    if strategy == "last4":
        values = column.to_pylist()
        masked = [None if v is None else f"***{str(v)[-4:]}" for v in values]
        return pa.chunked_array([pa.array(masked, type=pa.string())])

    raise SchemaProjectionError(f"Unsupported masking strategy '{strategy}'.")
