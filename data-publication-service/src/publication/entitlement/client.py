"""EntitlementClient: re-validates entitlement immediately before publish
(spec §9/§21), against the same authoritative endpoint scheduling-service
calls (POST /internal/v1/entitlements/evaluate on subscription-service).

Closes a concrete gap identified in the Phase 11 inventory: this service's
`publish()` previously trusted that whoever held the shared internal API
key had already checked entitlement upstream. A direct caller of this
service's internal publish API -- not just scheduling-service's normal
dispatch path -- now gets the same check.
"""

from __future__ import annotations

import httpx

from publication.config.settings import Settings


class EntitlementClient:
    def __init__(self, settings: Settings, *, timeout: float = 10.0) -> None:
        self._base_url = settings.subscription_service_base_url.rstrip("/") if settings.subscription_service_base_url else ""
        self._api_key = settings.subscription_service_api_key
        self._timeout = timeout

    @property
    def enabled(self) -> bool:
        return bool(self._base_url)

    def is_entitled(self, *, organization_id: str, tenant_id: str, data_product_id: str) -> bool:
        """Fails closed: any error talking to subscription-service is a DENY,
        never a silent ALLOW (spec §37)."""
        if not self.enabled:
            return False

        url = f"{self._base_url}/internal/v1/entitlements/evaluate"
        headers = {
            "Content-Type": "application/json",
            "x-internal-api-key": self._api_key,
            "x-actor-type": "SERVICE",
            "x-actor-id": "data-publication-service",
            "x-actor-role": "CATALOG_READER",
        }
        body = {"organization_id": organization_id, "tenant_id": tenant_id, "data_product_id": data_product_id}
        try:
            resp = httpx.post(url, json=body, headers=headers, timeout=self._timeout)
        except httpx.HTTPError:
            return False
        if resp.status_code != 200:
            return False
        return resp.json().get("decision") == "ALLOW"
