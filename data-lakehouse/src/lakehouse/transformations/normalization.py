"""Small, named value-normalization helpers usable from mapping config's
optional `transform:` key (see `expressions.py` for the registry). Kept
intentionally tiny -- AGENTS.md section 9 warns against building a generic
ETL expression language.
"""

from __future__ import annotations

from typing import Any


def trim(value: Any) -> Any:
    return value.strip() if isinstance(value, str) else value


def upper(value: Any) -> Any:
    return value.upper() if isinstance(value, str) else value


def lower(value: Any) -> Any:
    return value.lower() if isinstance(value, str) else value


def collapse_whitespace(value: Any) -> Any:
    return " ".join(value.split()) if isinstance(value, str) else value
