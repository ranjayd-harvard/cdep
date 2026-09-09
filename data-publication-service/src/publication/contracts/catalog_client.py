"""CatalogClient: resolves the authoritative published schema/policy for a
Data Product from the Phase 5 data-product-catalog-service, instead of
trusting whatever's in contracts_dir_path (see loader.py).

Talks to the Catalog's internal-only surface:

    GET /internal/v1/data-products/{id}/active-version
    GET /internal/v1/data-products/{id}/versions/{version}/contract

This is the "Preferred transition" described in
data-product-catalog-service/README.md:
Publication Service -> CatalogClient -> get active version -> get
publication contract -> publish, with the local YAML kept only as the
`contract_source=local` fallback for development (Settings.contract_source).
"""

from __future__ import annotations

import httpx

from publication.common.errors import CatalogServiceError
from publication.config.settings import Settings


def _auth_headers(settings: Settings) -> dict[str, str]:
    headers = {"x-actor-type": "SERVICE", "x-actor-id": "data-publication-service", "x-actor-role": "CATALOG_READER"}
    if settings.catalog_service_api_key:
        headers["x-internal-api-key"] = settings.catalog_service_api_key
    return headers


class CatalogClient:
    def __init__(self, settings: Settings, *, timeout: float = 15.0) -> None:
        self._base_url = settings.catalog_service_base_url.rstrip("/")
        self._headers = _auth_headers(settings)
        self._timeout = timeout

    def get_active_version(self, data_product_id: str) -> dict:
        """GET /internal/v1/data-products/{id}/active-version -> {dataProductId, version, contractVersion, status}."""
        url = f"{self._base_url}/internal/v1/data-products/{data_product_id}/active-version"
        try:
            resp = httpx.get(url, headers=self._headers, timeout=self._timeout)
        except httpx.HTTPError as exc:
            raise CatalogServiceError(f"Could not reach Catalog service at {url}: {exc}") from exc
        if resp.status_code != 200:
            raise CatalogServiceError(f"Catalog active-version lookup for '{data_product_id}' failed: {resp.status_code} {resp.text}")
        return resp.json()

    def get_contract(self, data_product_id: str, version: str) -> dict:
        """GET /internal/v1/data-products/{id}/versions/{version}/contract -> the normalized contract envelope."""
        url = f"{self._base_url}/internal/v1/data-products/{data_product_id}/versions/{version}/contract"
        try:
            resp = httpx.get(url, headers=self._headers, timeout=self._timeout)
        except httpx.HTTPError as exc:
            raise CatalogServiceError(f"Could not reach Catalog service at {url}: {exc}") from exc
        if resp.status_code != 200:
            raise CatalogServiceError(f"Catalog contract lookup for '{data_product_id}' v{version} failed: {resp.status_code} {resp.text}")
        return resp.json()

    def get_active_contract(self, data_product_id: str) -> dict:
        """Convenience: resolve the ACTIVE version, then fetch its contract."""
        active = self.get_active_version(data_product_id)
        return self.get_contract(data_product_id, active["version"])
