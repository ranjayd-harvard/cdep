from __future__ import annotations

from functools import lru_cache

import yaml

from publication.common.errors import ContractNotFoundError
from publication.config.settings import Settings, get_settings
from publication.models.contract import PublicationContract


def _merge_catalog_contract(local_data: dict, catalog_envelope: dict) -> dict:
    """Overlays the customer-facing fields the Catalog owns (spec §33/§63 --
    "the catalog does not own physical Gold schema") onto the local YAML.

    `source.table`, `tenantScope`, `masking`, and the publication-time
    quality *gate* (verifySchema/verifyRecordCount/...) are physical/
    operational wiring the Catalog deliberately doesn't model -- see
    data-product-catalog-service/README.md "Publication Service / Portal
    integration" -- so those keep coming from the local YAML either way.
    """
    contract = catalog_envelope["contract"]
    spec = contract["spec"]
    merged = dict(local_data)

    local_data_product = local_data.get("dataProduct", {})
    merged["dataProduct"] = {
        "id": contract["metadata"]["id"],
        "name": contract["metadata"]["name"],
        "version": contract["metadata"]["version"],
        "owner": spec.get("owner", {}).get("displayName") or local_data_product.get("owner", ""),
    }

    grain_keys = spec.get("grain", {}).get("keys")
    if grain_keys:
        merged["grain"] = grain_keys

    # Phase 11 (spec §21/§41): a field is excluded from the published
    # artifact entirely when the Catalog contract says so — either
    # customerVisible: false, or maskingPolicy: DENY (DENY always means
    # "never appears", regardless of customerVisible, since a field that's
    # both RESTRICTED and DENY should not depend on the author remembering
    # to also set customerVisible: false).
    catalog_fields = [
        f
        for f in spec.get("schema", [])
        if f.get("customerVisible", True) and f.get("maskingPolicy") != "DENY"
    ]
    merged["publishedSchema"] = [
        {"name": f["name"], "source": f["name"], "type": f["type"], "required": bool(f.get("required"))}
        for f in catalog_fields
    ]

    # Column policy (spec §21): REDACT/MASK/HASH are enforced identically
    # here (FILE delivery) and in data-product-api-service's
    # response-projector.ts (API delivery) — both driven from the same
    # Catalog field.maskingPolicy, never a per-contract hand-authored rule.
    _POLICY_TO_STRATEGY = {"REDACT": "redact", "HASH": "hash", "MASK": "last4"}
    catalog_masking = {
        f["name"]: {"strategy": _POLICY_TO_STRATEGY[f["maskingPolicy"]]}
        for f in catalog_fields
        if f.get("maskingPolicy") in _POLICY_TO_STRATEGY
    }
    if catalog_masking:
        merged["masking"] = {**local_data.get("masking", {}), **catalog_masking}

    for method in spec.get("delivery", {}).get("methods", []):
        if method.get("type") == "FILE" and method.get("enabled") and method.get("formats"):
            merged["formats"] = method["formats"]
            break

    publication = spec.get("publication", {})
    if publication.get("defaultFormat"):
        merged["defaultFormat"] = publication["defaultFormat"]

    merged_publication = dict(local_data.get("publication", {}))
    if publication.get("filenamePattern"):
        merged_publication["filenamePattern"] = publication["filenamePattern"]
    if publication.get("expirationHours"):
        merged_publication["expirationHours"] = publication["expirationHours"]
    merged["publication"] = merged_publication

    return merged


def _load_local_yaml(data_product_id: str, settings: Settings) -> dict:
    path = settings.contracts_dir_path / f"{data_product_id}.yaml"
    if not path.exists():
        raise ContractNotFoundError(f"No publication contract configured for '{data_product_id}': {path}")
    with open(path) as f:
        return yaml.safe_load(f)


@lru_cache
def load_publication_contract(data_product_id: str) -> PublicationContract:
    settings = get_settings()
    data = _load_local_yaml(data_product_id, settings)

    if settings.contract_source == "catalog":
        # Imported lazily so `httpx` (already a dependency, used by the
        # exchange client) is only touched when this mode is actually
        # selected -- default behavior is untouched (spec §51: "Do NOT
        # immediately break it").
        from publication.contracts.catalog_client import CatalogClient

        envelope = CatalogClient(settings).get_active_contract(data_product_id)
        data = _merge_catalog_contract(data, envelope)

    return PublicationContract(**data)
