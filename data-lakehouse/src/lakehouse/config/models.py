"""Typed configuration models loaded from YAML (config/*.yaml, contracts/**).

These are intentionally separate from `settings.py` (environment-driven,
secrets/endpoints) — models here describe *shape*, settings describe
*where/how to connect*.
"""

from __future__ import annotations

from pydantic import BaseModel, Field


class CsvContractConfig(BaseModel):
    header: bool = True
    delimiter: str = ","
    encoding: str = "UTF-8"


class JsonContractConfig(BaseModel):
    lines: bool = True
    encoding: str = "UTF-8"


class SchemaFieldConfig(BaseModel):
    name: str
    type: str
    required: bool = False


class SchemaContractConfig(BaseModel):
    mode: str = Field(default="PERMISSIVE", pattern="^(STRICT|PERMISSIVE)$")
    fields: list[SchemaFieldConfig] = Field(default_factory=list)


class QualityContractConfig(BaseModel):
    reject_unreadable_records: bool = True


class BronzeTargetConfig(BaseModel):
    namespace: str = "bronze"
    table: str


class DataProductContract(BaseModel):
    """Parsed form of contracts/bronze/<data_product_id>.yaml."""

    data_product_id: str = Field(alias="dataProductId")
    version: str
    owner: str
    source_formats: list[str] = Field(alias="source_formats", default_factory=list)
    bronze: BronzeTargetConfig
    csv: CsvContractConfig = Field(default_factory=CsvContractConfig)
    json_: JsonContractConfig = Field(default_factory=JsonContractConfig, alias="json")
    schema_: SchemaContractConfig = Field(default_factory=SchemaContractConfig, alias="schema")
    quality: QualityContractConfig = Field(default_factory=QualityContractConfig)

    model_config = {"populate_by_name": True}

    @classmethod
    def from_yaml_dict(cls, data: dict) -> DataProductContract:
        return cls(
            dataProductId=data["dataProductId"],
            version=data["version"],
            owner=data.get("owner", "unknown"),
            source_formats=data.get("source", {}).get("formats", []),
            bronze=BronzeTargetConfig(**data["bronze"]),
            csv=CsvContractConfig(**data.get("csv", {})),
            json=JsonContractConfig(**data.get("json", {})),
            schema=SchemaContractConfig(**data.get("schema", {})),
            quality=QualityContractConfig(**data.get("quality", {})),
        )
