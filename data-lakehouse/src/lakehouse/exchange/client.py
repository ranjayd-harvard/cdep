"""ExchangeServiceClient abstraction (AGENTS.md section 10).

Ingestion code depends only on the `ExchangeServiceClient` protocol -- never
on a concrete REST shape. `MockExchangeServiceClient` is the primary local
implementation (reads exchange context from fixture objects staged in the
exchange-inbound bucket). `HttpExchangeServiceClient` talks to a real
data-exchange-service instance for the subset of operations it currently
exposes; see its docstring for the known gap (no ingestion-callback
endpoints yet in Phase 1).
"""

from __future__ import annotations

import json
from typing import Protocol

import structlog

from lakehouse.common.time import utcnow
from lakehouse.exchange.manifest import UNKNOWN_SCHEMA_VERSION, parse_manifest
from lakehouse.exchange.models import ExchangeManifest, ExchangeReady
from lakehouse.storage.interface import StorageClient

log = structlog.get_logger(__name__)

# Internal lakehouse ingestion statuses -> Exchange Service status vocabulary.
# Kept here, isolated, so internal statuses (see ingestion/status.py) never
# leak into the Exchange Service's own enum (AGENTS.md section 35).
_INGESTION_TO_EXCHANGE_STATUS = {
    "CREATED": "QUEUED_FOR_INGESTION",
    "READING_SOURCE": "PROCESSING",
    "WRITING_BRONZE": "PROCESSING",
    "COMPLETED": "COMPLETED",
    "FAILED": "FAILED",
    "SKIPPED_DUPLICATE": "COMPLETED",
}


def translate_ingestion_status_to_exchange_status(ingestion_status: str) -> str:
    return _INGESTION_TO_EXCHANGE_STATUS.get(ingestion_status, "PROCESSING")


class ExchangeServiceClient(Protocol):
    def get_exchange(self, exchange_id: str) -> ExchangeReady: ...

    def get_manifest(self, exchange_id: str) -> ExchangeManifest: ...

    def mark_processing(self, exchange_id: str, ingestion_id: str) -> None: ...

    def mark_ingestion_complete(self, exchange_id: str, ingestion_id: str) -> None: ...

    def mark_ingestion_failed(self, exchange_id: str, ingestion_id: str, error: str) -> None: ...

    def record_ingestion_reference(
        self, exchange_id: str, ingestion_id: str, bronze_table: str
    ) -> None: ...


class MockExchangeServiceClient:
    """Local fixture-backed client.

    Expects, per exchange, two objects in the exchange-inbound bucket under
    prefix `exchanges/{exchange_id}/`:
      - manifest.json               (see contracts/exchange-manifest.schema.json)
      - <file.originalFilename>     (the source data file)

    These are staged by scripts/create_sample_exchange.py, mirroring what
    the real Exchange Service would have already placed there during the
    customer upload flow.
    """

    def __init__(self, storage: StorageClient, bucket: str) -> None:
        self._storage = storage
        self._bucket = bucket

    def _manifest_key(self, exchange_id: str) -> str:
        return f"exchanges/{exchange_id}/manifest.json"

    def get_manifest(self, exchange_id: str) -> ExchangeManifest:
        key = self._manifest_key(exchange_id)
        if not self._storage.exists(self._bucket, key):
            from lakehouse.common.errors import ExchangeNotFoundError

            raise ExchangeNotFoundError(f"No fixture manifest found for exchange {exchange_id}")
        with self._storage.open(self._bucket, key) as f:
            raw = json.load(f)
        file_key = f"exchanges/{exchange_id}/{raw['file']['originalFilename']}"
        return parse_manifest(raw, storage_bucket=self._bucket, storage_key=file_key)

    def get_exchange(self, exchange_id: str) -> ExchangeReady:
        manifest = self.get_manifest(exchange_id)
        return ExchangeReady(
            exchangeId=manifest.exchange.exchange_id,
            organizationId=manifest.ownership.organization_id,
            tenantId=manifest.ownership.tenant_id,
            dataProductId=manifest.data_product.data_product_id,
            schemaVersion=manifest.data_product.schema_version,
            direction=manifest.exchange.direction,
            status=manifest.exchange.status,
        )

    def mark_processing(self, exchange_id: str, ingestion_id: str) -> None:
        log.info(
            "exchange.status.mock_update",
            exchange_id=exchange_id,
            ingestion_id=ingestion_id,
            status="PROCESSING",
        )

    def mark_ingestion_complete(self, exchange_id: str, ingestion_id: str) -> None:
        log.info(
            "exchange.status.mock_update",
            exchange_id=exchange_id,
            ingestion_id=ingestion_id,
            status="COMPLETED",
        )

    def mark_ingestion_failed(self, exchange_id: str, ingestion_id: str, error: str) -> None:
        log.info(
            "exchange.status.mock_update",
            exchange_id=exchange_id,
            ingestion_id=ingestion_id,
            status="FAILED",
            error_code=error,
        )

    def record_ingestion_reference(
        self, exchange_id: str, ingestion_id: str, bronze_table: str
    ) -> None:
        log.info(
            "exchange.ingestion_reference.mock_record",
            exchange_id=exchange_id,
            ingestion_id=ingestion_id,
            bronze_table=bronze_table,
            recorded_at=utcnow().isoformat(),
        )


class HttpExchangeServiceClient:
    """Talks to a real data-exchange-service instance.

    `get_exchange` and `get_manifest` both call the same internal-only
    endpoint (`GET /internal/v1/exchanges/{id}/manifest`, gated by
    `x-internal-api-key` -- NOT customer JWT auth) that data-exchange-service
    added specifically for this integration: it reads back the
    already-written InboundManifest object verbatim and returns it alongside
    the DATA file's own storage coordinates (bucket/key), which customer-
    facing responses never expose. Calling it twice per ingestion run is a
    deliberate simplicity trade-off over caching.

    KNOWN GAP: data-exchange-service still has no ingestion-status-callback
    endpoints (mark_processing/mark_ingestion_complete/mark_ingestion_failed/
    record_ingestion_reference) -- those calls degrade to warning logs
    instead of raising, so ingestion can still complete while the real
    callback endpoints are built. Replace the bodies of those methods once
    Phase 1 adds them -- no other lakehouse code needs to change, because
    callers only depend on the `ExchangeServiceClient` protocol.
    """

    def __init__(self, base_url: str, api_key: str) -> None:
        self._base_url = base_url.rstrip("/")
        self._api_key = api_key

    def _internal_headers(self) -> dict[str, str]:
        return {"Accept": "application/json", "x-internal-api-key": self._api_key}

    def _get_manifest_response(self, exchange_id: str) -> dict:
        import urllib.error
        import urllib.request

        url = f"{self._base_url}/internal/v1/exchanges/{exchange_id}/manifest"
        req = urllib.request.Request(url, headers=self._internal_headers())
        try:
            with urllib.request.urlopen(req, timeout=10) as resp:  # noqa: S310
                return json.loads(resp.read())
        except urllib.error.HTTPError as exc:
            body = exc.read().decode("utf-8", errors="replace")
            if exc.code == 404:
                from lakehouse.common.errors import ExchangeNotFoundError

                raise ExchangeNotFoundError(f"Exchange {exchange_id} not found: {body}") from exc
            if exc.code == 409:
                from lakehouse.common.errors import ExchangeNotReadyError

                raise ExchangeNotReadyError(
                    f"Exchange {exchange_id} has no manifest yet (upload not completed): {body}"
                ) from exc
            raise

    def get_exchange(self, exchange_id: str) -> ExchangeReady:
        data = self._get_manifest_response(exchange_id)
        m = data["manifest"]
        return ExchangeReady(
            exchangeId=m["exchange"]["exchangeId"],
            organizationId=m["ownership"]["organizationId"],
            tenantId=m["ownership"]["tenantId"],
            dataProductId=m["dataProduct"]["dataProductId"],
            schemaVersion=m["dataProduct"].get("schemaVersion") or UNKNOWN_SCHEMA_VERSION,
            direction=m["exchange"]["direction"],
            status=m["exchange"]["status"],
        )

    def get_manifest(self, exchange_id: str) -> ExchangeManifest:
        data = self._get_manifest_response(exchange_id)
        storage = data["storage"]
        return parse_manifest(
            data["manifest"],
            storage_bucket=storage["bucketName"],
            storage_key=storage["objectKey"],
        )

    def mark_processing(self, exchange_id: str, ingestion_id: str) -> None:
        log.warning(
            "exchange.status_callback.unsupported",
            exchange_id=exchange_id,
            ingestion_id=ingestion_id,
            status="PROCESSING",
        )

    def mark_ingestion_complete(self, exchange_id: str, ingestion_id: str) -> None:
        log.warning(
            "exchange.status_callback.unsupported",
            exchange_id=exchange_id,
            ingestion_id=ingestion_id,
            status="COMPLETED",
        )

    def mark_ingestion_failed(self, exchange_id: str, ingestion_id: str, error: str) -> None:
        log.warning(
            "exchange.status_callback.unsupported",
            exchange_id=exchange_id,
            ingestion_id=ingestion_id,
            status="FAILED",
            error_code=error,
        )

    def record_ingestion_reference(
        self, exchange_id: str, ingestion_id: str, bronze_table: str
    ) -> None:
        log.warning(
            "exchange.ingestion_reference.unsupported",
            exchange_id=exchange_id,
            ingestion_id=ingestion_id,
            bronze_table=bronze_table,
        )
