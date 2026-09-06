"""ExchangeServiceClient (AGENTS.md sections 21/22/24).

Talks to data-exchange-service's internal-only publication surface:

    POST /internal/v1/outbound-publications
    POST /internal/v1/outbound-publications/{exchangeId}/complete
    POST /internal/v1/outbound-publications/{exchangeId}/fail
    GET  /internal/v1/exchanges/{exchangeId}/manifest

These are additive endpoints on data-exchange-service, separate from its
pre-existing `/internal/v1/publications` fixture-content simulator (which
cdep's own upload-triggered demo still uses and which this service does
not touch) -- see data-exchange-service's
src/modules/outbound-publications/ for the implementation this client
adapts to.
"""

from __future__ import annotations

from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

import httpx

from publication.common.errors import ExchangeServiceError
from publication.config.settings import Settings
from publication.exchange.auth import internal_auth_headers
from publication.exchange.models import (
    CompletedOutboundPublication,
    CreatedOutboundPublication,
    ExchangeManifestInfo,
    UploadTarget,
)


class ExchangeServiceClient:
    def __init__(self, settings: Settings, *, timeout: float = 30.0) -> None:
        self._base_url = settings.exchange_service_base_url.rstrip("/")
        self._headers = internal_auth_headers(settings)
        self._timeout = timeout
        self._storage_relay_host = settings.exchange_storage_relay_host or None

    def create_outbound_publication(
        self,
        *,
        organization_id: str,
        tenant_id: str,
        data_product_id: str,
        product_version: str,
        filename: str,
        format: str,
        size_bytes: int,
        record_count: int,
        checksum_algorithm: str,
        checksum: str,
        source_publication_id: str,
        expiration_hours: int,
    ) -> CreatedOutboundPublication:
        body = {
            "organizationId": organization_id,
            "tenantId": tenant_id,
            "dataProductId": data_product_id,
            "productVersion": product_version,
            "filename": filename,
            "format": format,
            "sizeBytes": size_bytes,
            "recordCount": record_count,
            "checksumAlgorithm": checksum_algorithm,
            "checksum": checksum,
            "sourcePublicationId": source_publication_id,
            "expirationHours": expiration_hours,
        }
        data = self._post("/internal/v1/outbound-publications", body)
        upload = data["upload"]
        return CreatedOutboundPublication(
            exchange_id=data["exchangeId"],
            status=data["status"],
            upload=UploadTarget(
                method=upload["method"],
                url=upload["url"],
                expires_in_seconds=upload["expiresInSeconds"],
                content_type=upload["contentType"],
            ),
        )

    def upload_artifact(self, upload: UploadTarget, local_path: str) -> None:
        # Content-Type MUST match exactly what the Exchange Service signed
        # the PUT URL against -- SigV4 covers the Content-Type header when
        # PutObjectCommand was constructed with one, so sending a different
        # value here fails with SignatureDoesNotMatch, not a content error.
        with open(local_path, "rb") as f:
            body = f.read()
        headers = {"Content-Type": upload.content_type}
        url = upload.url

        if self._storage_relay_host:
            # Connect to a host this container can actually reach, while
            # keeping the `Host` header equal to what the URL's SigV4
            # signature (`X-Amz-SignedHeaders=host`) was computed against --
            # unlike Node's `fetch()` (see docs/exchange-service-integration.md),
            # httpx sends an explicitly-supplied `Host` header as-is rather
            # than silently overwriting it with the connection target, so
            # this works without any lower-level socket tricks.
            parts = urlsplit(url)
            headers["Host"] = parts.netloc
            url = urlunsplit((parts.scheme, self._storage_relay_host, parts.path, parts.query, parts.fragment))

        try:
            response = httpx.request(upload.method, url, content=body, headers=headers, timeout=self._timeout)
            response.raise_for_status()
        except httpx.HTTPError as exc:
            raise ExchangeServiceError(f"Artifact upload to signed URL failed: {exc}") from exc

    def complete_outbound_publication(
        self,
        exchange_id: str,
        *,
        publication_id: str,
        gold_snapshot_id: str | None,
        gold_pipeline_run_id: str | None,
    ) -> CompletedOutboundPublication:
        body = {
            "publicationId": publication_id,
            "goldSnapshotId": gold_snapshot_id,
            "goldPipelineRunId": gold_pipeline_run_id,
        }
        data = self._post(f"/internal/v1/outbound-publications/{exchange_id}/complete", body)
        return CompletedOutboundPublication(exchange_id=data["exchangeId"], status=data["status"])

    def mark_publication_failed(self, exchange_id: str, *, reason: str) -> None:
        self._post(f"/internal/v1/outbound-publications/{exchange_id}/fail", {"reason": reason})

    def get_exchange(self, exchange_id: str) -> ExchangeManifestInfo:
        # Response shape: {"manifest": {"exchange": {...}, ...}, "storage": {...}}
        # (data-exchange-service's getExchangeManifestInternal). Only exists
        # once the exchange has a manifest.json -- i.e. after `complete` has
        # run -- so this raises for a still-PREPARING exchange; callers
        # (reconciliation) treat that as its own finding, not a crash.
        data = self._get(f"/internal/v1/exchanges/{exchange_id}/manifest")
        exchange = data.get("manifest", {}).get("exchange", {})
        return ExchangeManifestInfo(
            exchange_id=exchange.get("exchangeId", exchange_id),
            status=exchange.get("status", "UNKNOWN"),
            direction=exchange.get("direction", "UNKNOWN"),
            raw=data,
        )

    def _post(self, path: str, body: dict) -> dict:
        try:
            response = httpx.post(f"{self._base_url}{path}", json=body, headers=self._headers, timeout=self._timeout)
            response.raise_for_status()
            return response.json()
        except httpx.HTTPStatusError as exc:
            raise ExchangeServiceError(
                f"Exchange Service returned {exc.response.status_code} for POST {path}: {exc.response.text}"
            ) from exc
        except httpx.HTTPError as exc:
            raise ExchangeServiceError(f"Exchange Service request failed for POST {path}: {exc}") from exc

    def _get(self, path: str) -> dict:
        try:
            response = httpx.get(f"{self._base_url}{path}", headers=self._headers, timeout=self._timeout)
            response.raise_for_status()
            return response.json()
        except httpx.HTTPStatusError as exc:
            raise ExchangeServiceError(
                f"Exchange Service returned {exc.response.status_code} for GET {path}: {exc.response.text}"
            ) from exc
        except httpx.HTTPError as exc:
            raise ExchangeServiceError(f"Exchange Service request failed for GET {path}: {exc}") from exc
