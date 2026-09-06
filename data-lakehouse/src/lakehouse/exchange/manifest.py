from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import jsonschema

from lakehouse.common.errors import ManifestValidationError
from lakehouse.config.settings import REPO_ROOT
from lakehouse.exchange.models import ExchangeManifest

_SCHEMA_PATH = REPO_ROOT / "contracts" / "exchange-manifest.schema.json"

# data-exchange-service allows schema_version to be null (not every upload
# declares one) -- IngestionContext/lineage/idempotency all treat
# schema_version as a required string, so a missing value is normalized to
# this sentinel right at the manifest boundary rather than threading
# Optional[str] through the rest of the pipeline.
UNKNOWN_SCHEMA_VERSION = "unknown"


def _load_schema() -> dict:
    with open(_SCHEMA_PATH) as f:
        return json.load(f)


def validate_manifest_dict(raw: dict[str, Any]) -> None:
    """Validate raw manifest JSON against the exchange-manifest contract
    (AGENTS.md section 12). Raises ManifestValidationError on any violation."""
    schema = _load_schema()
    try:
        jsonschema.validate(instance=raw, schema=schema)
    except jsonschema.ValidationError as exc:
        raise ManifestValidationError(f"Manifest failed schema validation: {exc.message}") from exc


def parse_manifest(
    raw: dict[str, Any], *, storage_bucket: str | None = None, storage_key: str | None = None
) -> ExchangeManifest:
    validate_manifest_dict(raw)
    if raw.get("dataProduct", {}).get("schemaVersion") is None:
        raw = {**raw, "dataProduct": {**raw["dataProduct"], "schemaVersion": UNKNOWN_SCHEMA_VERSION}}
    manifest = ExchangeManifest.model_validate(raw)
    if storage_bucket is not None:
        manifest.storage_bucket = storage_bucket
    if storage_key is not None:
        manifest.storage_key = storage_key
    return manifest


def load_manifest_file(path: str | Path) -> dict[str, Any]:
    with open(path) as f:
        return json.load(f)
