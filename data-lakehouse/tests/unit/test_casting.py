from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest

from lakehouse.transformations.casting import CastError, cast_value


def test_cast_string_strips_whitespace():
    assert cast_value("  EVT1  ", "string") == "EVT1"


def test_cast_long_from_csv_string():
    assert cast_value("1200", "long") == 1200


def test_cast_long_rejects_non_numeric():
    with pytest.raises(CastError):
        cast_value("not-a-number", "long")


def test_cast_date_from_iso_string():
    assert cast_value("2026-09-01", "date") == date(2026, 9, 1)


def test_cast_date_rejects_unparseable_value():
    with pytest.raises(CastError):
        cast_value("09/01/2026", "date")


def test_cast_decimal_quantizes_to_declared_scale():
    assert cast_value("84000", "decimal(18,2)") == Decimal("84000.00")
    assert cast_value("84000.006", "decimal(18,2)") == Decimal("84000.01")


def test_cast_decimal_rejects_excess_precision():
    with pytest.raises(CastError):
        cast_value("1" * 20, "decimal(18,2)")


def test_cast_none_and_empty_string_pass_through_as_none():
    assert cast_value(None, "long") is None
    assert cast_value("", "date") is None


def test_cast_unknown_type_raises():
    with pytest.raises(CastError):
        cast_value("x", "not-a-real-type")
