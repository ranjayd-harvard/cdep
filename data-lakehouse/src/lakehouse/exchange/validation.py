"""Ingestion-eligibility checks against trusted exchange context.

This is deliberately narrow: technical validation only, and only what
guards the Exchange <-> Lakehouse boundary. It does not re-run the
customer-facing business validation the Exchange Service already performed
(AGENTS.md section 23).
"""

from __future__ import annotations

from lakehouse.common.errors import ExchangeNotReadyError, ManifestValidationError
from lakehouse.exchange.models import ExchangeManifest, ExchangeReady

# The real data-exchange-service INBOUND status machine is:
#   VALIDATED -> QUEUED_FOR_INGESTION -> PROCESSING -> COMPLETED
# Both VALIDATED and QUEUED_FOR_INGESTION are accepted as ingestion-ready so
# the lakehouse can be invoked either right after validation or after an
# explicit queueing step, without coupling to which one a given deployment
# uses.
ALLOWED_INGESTION_STATUSES = {"VALIDATED", "QUEUED_FOR_INGESTION"}
REQUIRED_DIRECTION = "INBOUND"


def assert_exchange_ready_for_ingestion(exchange: ExchangeReady) -> None:
    if exchange.direction != REQUIRED_DIRECTION:
        raise ExchangeNotReadyError(
            f"Exchange {exchange.exchange_id} has direction '{exchange.direction}', "
            f"expected '{REQUIRED_DIRECTION}'"
        )
    if exchange.status not in ALLOWED_INGESTION_STATUSES:
        raise ExchangeNotReadyError(
            f"Exchange {exchange.exchange_id} has status '{exchange.status}', "
            f"which is not ingestion-ready (allowed: {sorted(ALLOWED_INGESTION_STATUSES)})"
        )


def assert_manifest_matches_exchange(manifest: ExchangeManifest, exchange: ExchangeReady) -> None:
    if manifest.exchange.exchange_id != exchange.exchange_id:
        raise ManifestValidationError(
            f"Manifest exchangeId '{manifest.exchange.exchange_id}' does not match "
            f"requested exchange_id '{exchange.exchange_id}'"
        )
    if manifest.ownership.organization_id != exchange.organization_id:
        raise ManifestValidationError("Manifest organizationId does not match exchange context")
    if manifest.ownership.tenant_id != exchange.tenant_id:
        raise ManifestValidationError("Manifest tenantId does not match exchange context")
    if manifest.data_product.data_product_id != exchange.data_product_id:
        raise ManifestValidationError("Manifest dataProductId does not match exchange context")
