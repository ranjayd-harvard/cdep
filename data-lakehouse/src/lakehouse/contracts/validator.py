"""Structural contract validation (AGENTS.md Phase 3 objective #5).

Deliberately narrow: this checks *shape* (are the columns a mapping/contract
depends on actually present) before any row-level transformation is
attempted. Row-level business-rule validation is the quality engine's job
(`lakehouse.quality.engine`), not this module's.
"""

from __future__ import annotations

from lakehouse.common.errors import LakehouseError
from lakehouse.contracts.models import GoldDataProductContract
from lakehouse.transformations.mapping import MappingConfig


class MappingSourceColumnsMissingError(LakehouseError):
    error_code = "MAPPING_SOURCE_COLUMNS_MISSING"


class GoldGrainAmbiguousError(LakehouseError):
    error_code = "GOLD_GRAIN_AMBIGUOUS"


def validate_source_columns(observed_columns: list[str], mapping: MappingConfig) -> list[str]:
    """Raises if any *required* mapped field's source column is missing from
    the Bronze data actually read. Returns the list of source columns that
    were found, for observability."""
    observed = set(observed_columns)
    missing = [
        field.source
        for field in mapping.fields.values()
        if field.required and field.source not in observed
    ]
    if missing:
        raise MappingSourceColumnsMissingError(
            f"Bronze source is missing required column(s) for mapping "
            f"'{mapping.source_data_product_id}' -> '{mapping.target_entity}': {missing}"
        )
    return [f.source for f in mapping.fields.values() if f.source in observed]


def validate_gold_grain(records: list[dict], contract: GoldDataProductContract) -> None:
    """A Gold Data Product must not have an ambiguous grain (AGENTS.md
    section 25) -- the declared `keys` must uniquely identify each row."""
    seen: set[tuple] = set()
    for record in records:
        key = tuple(record.get(k) for k in contract.keys)
        if key in seen:
            raise GoldGrainAmbiguousError(
                f"Gold grain violated for '{contract.data_product_id}': "
                f"duplicate key {dict(zip(contract.keys, key, strict=True))}"
            )
        seen.add(key)
