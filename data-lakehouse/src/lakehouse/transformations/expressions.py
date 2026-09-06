"""A deliberately tiny named-transform registry -- NOT a generic ETL
expression language (AGENTS.md section 9 explicitly warns against building
one). A mapping field may reference one of these names via its optional
`transform:` key; anything more complex belongs in a real Python
transformation function registered against the pipeline, not here.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from lakehouse.transformations import normalization

TRANSFORM_REGISTRY: dict[str, Callable[[Any], Any]] = {
    "trim": normalization.trim,
    "upper": normalization.upper,
    "lower": normalization.lower,
    "collapse_whitespace": normalization.collapse_whitespace,
}


def apply_transform(value: Any, transform_name: str | None) -> Any:
    if not transform_name:
        return value
    try:
        fn = TRANSFORM_REGISTRY[transform_name]
    except KeyError:
        raise ValueError(f"Unknown transform '{transform_name}'") from None
    return fn(value)
