from __future__ import annotations

from lakehouse.exchange.manifest import parse_manifest
from lakehouse.exchange.models import ExchangeReady
from lakehouse.ingestion.ingestion_context import IngestionContext


def _manifest():
    raw = {
        "manifestVersion": "1.0",
        "exchange": {"exchangeId": "exc-1", "direction": "INBOUND", "status": "VALIDATED"},
        "ownership": {"organizationId": "org-1", "tenantId": "tenant-1"},
        "dataProduct": {"dataProductId": "event-data", "schemaVersion": "1.0"},
        "file": {
            "originalFilename": "events.csv",
            "format": "CSV",
            "sizeBytes": 10,
            "checksumAlgorithm": "SHA-256",
            "checksum": "abc",
        },
        "source": {"channel": "CUSTOMER_PORTAL"},
        "timestamps": {"receivedAt": "2026-09-05T00:00:00Z"},
    }
    return parse_manifest(raw, storage_bucket="exchange-inbound", storage_key="exchanges/exc-1/events.csv")


def _exchange():
    return ExchangeReady(
        exchangeId="exc-1",
        organizationId="org-1",
        tenantId="tenant-1",
        dataProductId="event-data",
        schemaVersion="1.0",
        direction="INBOUND",
        status="VALIDATED",
    )


def test_ingestion_context_derives_only_from_trusted_sources():
    ctx = IngestionContext.create(ingestion_id="ing-test-1", exchange=_exchange(), manifest=_manifest())
    assert ctx.organization_id == "org-1"
    assert ctx.tenant_id == "tenant-1"
    assert ctx.exchange_id == "exc-1"
    assert ctx.source_bucket == "exchange-inbound"
    assert ctx.source_key == "exchanges/exc-1/events.csv"
    assert ctx.source_path == "exchange-inbound/exchanges/exc-1/events.csv"
    assert ctx.source_format == "CSV"
    assert ctx.source_checksum == "abc"
    assert ctx.received_at is not None
