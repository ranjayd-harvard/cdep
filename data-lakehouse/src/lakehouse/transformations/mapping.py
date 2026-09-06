"""Configuration-driven Bronze->Silver mapping (AGENTS.md section 9).

Loads mappings/bronze_to_silver/<mapping_id>.yaml and applies it to one
Bronze row at a time: source column -> target column, canonical type cast,
required-ness, default value, optional named transform. No hard-coded
per-entity mapping code.
"""

from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
from typing import Any

import yaml
from pydantic import BaseModel, Field

from lakehouse.config.settings import REPO_ROOT
from lakehouse.transformations.casting import CastError, cast_value
from lakehouse.transformations.expressions import apply_transform

MAPPINGS_DIR = REPO_ROOT / "mappings"


class MappingSourceConfig(BaseModel):
    table: str
    data_product_id: str = Field(alias="dataProductId")

    model_config = {"populate_by_name": True}


class MappingTargetConfig(BaseModel):
    table: str
    entity: str


class MappingKeysConfig(BaseModel):
    business_key: list[str] = Field(alias="businessKey")

    model_config = {"populate_by_name": True}


class MappingFieldConfig(BaseModel):
    source: str
    type: str
    required: bool = False
    default: Any | None = None
    transform: str | None = None


class MappingLineageConfig(BaseModel):
    source_exchange_id: str = Field(default="_exchange_id", alias="source_exchange_id")
    source_ingestion_id: str = Field(default="_ingestion_id", alias="source_ingestion_id")

    model_config = {"populate_by_name": True}


class MappingConfig(BaseModel):
    """Parsed form of mappings/bronze_to_silver/<mapping_id>.yaml."""

    version: str = "1.0"
    source: MappingSourceConfig
    target: MappingTargetConfig
    keys: MappingKeysConfig
    mapping: dict[str, MappingFieldConfig]
    lineage: MappingLineageConfig = Field(default_factory=MappingLineageConfig)

    model_config = {"populate_by_name": True}

    @property
    def fields(self) -> dict[str, MappingFieldConfig]:
        return self.mapping

    @property
    def source_table(self) -> str:
        return self.source.table

    @property
    def source_data_product_id(self) -> str:
        return self.source.data_product_id

    @property
    def target_table(self) -> str:
        return self.target.table

    @property
    def target_entity(self) -> str:
        return self.target.entity

    @property
    def business_key(self) -> list[str]:
        return self.keys.business_key


@lru_cache
def load_mapping(mapping_id: str) -> MappingConfig:
    path = MAPPINGS_DIR / "bronze_to_silver" / f"{mapping_id}.yaml"
    if not path.exists():
        raise FileNotFoundError(f"No mapping configured at: {path}")
    with open(path) as f:
        data = yaml.safe_load(f)
    return MappingConfig(**data)


@dataclass
class MappedRecord:
    record: dict[str, Any] | None
    error: str | None = None
    failed_field: str | None = None


def apply_mapping(bronze_row: dict[str, Any], mapping: MappingConfig) -> MappedRecord:
    """Map one Bronze row to a canonical (pre-lineage) Silver record. Never
    silently drops or defaults an unparseable required value -- returns a
    `MappedRecord` with `.error` set so the caller can quarantine it."""
    target: dict[str, Any] = {}
    for target_field, field_cfg in mapping.fields.items():
        raw_value = bronze_row.get(field_cfg.source)

        if raw_value is None and field_cfg.default is not None:
            raw_value = field_cfg.default

        if raw_value is None:
            if field_cfg.required:
                return MappedRecord(
                    record=None,
                    error=f"Required field '{target_field}' (source '{field_cfg.source}') is missing",
                    failed_field=target_field,
                )
            target[target_field] = None
            continue

        try:
            value = apply_transform(raw_value, field_cfg.transform)
            target[target_field] = cast_value(value, field_cfg.type)
        except CastError as exc:
            return MappedRecord(
                record=None,
                error=f"Field '{target_field}': {exc}",
                failed_field=target_field,
            )

        if target[target_field] is None and field_cfg.required:
            return MappedRecord(
                record=None,
                error=f"Required field '{target_field}' (source '{field_cfg.source}') is empty",
                failed_field=target_field,
            )

    return MappedRecord(record=target)
