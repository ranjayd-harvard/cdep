"""Canonical type casting for Silver (AGENTS.md section 11).

A value that cannot be cast is never silently dropped/defaulted -- callers
must route a `CastError` into the Silver reject path (section 12).
"""

from __future__ import annotations

import re
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from typing import Any

_DECIMAL_TYPE_RE = re.compile(r"^decimal\((\d+),\s*(\d+)\)$")


class CastError(ValueError):
    pass


def _cast_date(value: Any) -> date:
    if isinstance(value, date) and not isinstance(value, datetime):
        return value
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, str):
        try:
            return date.fromisoformat(value.strip())
        except ValueError as exc:
            raise CastError(f"Cannot parse '{value}' as an ISO date (YYYY-MM-DD)") from exc
    raise CastError(f"Cannot cast {value!r} to date")


def _cast_decimal(value: Any, precision: int, scale: int) -> Decimal:
    try:
        result = Decimal(str(value))
    except (InvalidOperation, ValueError) as exc:
        raise CastError(f"Cannot cast {value!r} to decimal({precision},{scale})") from exc
    quantized = result.quantize(Decimal(1).scaleb(-scale))
    digits = len(quantized.as_tuple().digits)
    if digits > precision:
        raise CastError(f"Value {value!r} exceeds decimal({precision},{scale}) precision")
    return quantized


def cast_value(value: Any, canonical_type: str) -> Any:
    """Cast `value` to `canonical_type` (string | long | double | boolean |
    date | decimal(p,s)). Raises `CastError` on failure. `None`/`""` pass
    through as `None` -- required-ness is enforced separately by the caller
    (a required field's `None` is itself the failure)."""
    if value is None or value == "":
        return None

    if canonical_type == "string":
        return str(value).strip()

    if canonical_type in ("long", "int"):
        try:
            return int(str(value).strip())
        except (ValueError, TypeError) as exc:
            raise CastError(f"Cannot cast {value!r} to {canonical_type}") from exc

    if canonical_type in ("double", "float"):
        try:
            return float(str(value).strip())
        except (ValueError, TypeError) as exc:
            raise CastError(f"Cannot cast {value!r} to {canonical_type}") from exc

    if canonical_type == "boolean":
        if isinstance(value, bool):
            return value
        if isinstance(value, str):
            return value.strip().lower() in ("true", "1", "yes")
        return bool(value)

    if canonical_type == "date":
        return _cast_date(value)

    decimal_match = _DECIMAL_TYPE_RE.match(canonical_type)
    if decimal_match:
        precision, scale = int(decimal_match.group(1)), int(decimal_match.group(2))
        return _cast_decimal(value, precision, scale)

    raise CastError(f"Unknown canonical type '{canonical_type}'")
