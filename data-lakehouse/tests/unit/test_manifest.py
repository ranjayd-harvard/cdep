from __future__ import annotations

import pytest

from lakehouse.common.errors import ExchangeNotReadyError, ManifestValidationError
from lakehouse.exchange.manifest import (
    UNKNOWN_SCHEMA_VERSION,
    parse_manifest,
    validate_manifest_dict,
)
from lakehouse.exchange.models import ExchangeReady
from lakehouse.exchange.validation import (
    assert_exchange_ready_for_ingestion,
    assert_manifest_matches_exchange,
)


def _valid_manifest_dict() -> dict:
    return {
        "manifestVersion": "1.0",
        "exchange": {"exchangeId": "exc-1", "direction": "INBOUND", "status": "VALIDATED"},
        "ownership": {"organizationId": "org-1", "tenantId": "tenant-1"},
        "submittedBy": {"userId": "usr-1"},
        "dataProduct": {"dataProductId": "event-data", "schemaVersion": "1.0"},
        "file": {
            "originalFilename": "events.csv",
            "contentType": "text/csv",
            "format": "CSV",
            "sizeBytes": 100,
            "checksumAlgorithm": "SHA-256",
            "checksum": "abc123",
        },
        "source": {"channel": "CUSTOMER_PORTAL"},
        "timestamps": {"receivedAt": "2026-09-05T00:00:00Z"},
    }


def test_valid_manifest_passes_schema_validation():
    validate_manifest_dict(_valid_manifest_dict())  # should not raise


def test_manifest_missing_ownership_fails():
    raw = _valid_manifest_dict()
    del raw["ownership"]
    with pytest.raises(ManifestValidationError):
        validate_manifest_dict(raw)


def test_manifest_null_schema_version_is_accepted_and_normalized():
    """data-exchange-service allows schema_version to be null (not every
    upload declares one) -- must not crash, and must not leak None past
    the manifest boundary."""
    raw = _valid_manifest_dict()
    raw["dataProduct"]["schemaVersion"] = None
    manifest = parse_manifest(raw, storage_bucket="b", storage_key="k")
    assert manifest.data_product.schema_version == UNKNOWN_SCHEMA_VERSION


def test_manifest_bad_direction_fails():
    raw = _valid_manifest_dict()
    raw["exchange"]["direction"] = "SIDEWAYS"
    with pytest.raises(ManifestValidationError):
        validate_manifest_dict(raw)


def test_parse_manifest_round_trips_fields():
    manifest = parse_manifest(
        _valid_manifest_dict(), storage_bucket="exchange-inbound", storage_key="exchanges/exc-1/events.csv"
    )
    assert manifest.exchange.exchange_id == "exc-1"
    assert manifest.ownership.organization_id == "org-1"
    assert manifest.file.checksum == "abc123"
    assert manifest.storage_bucket == "exchange-inbound"


def test_assert_exchange_ready_rejects_outbound():
    exchange = ExchangeReady(
        exchangeId="exc-1",
        organizationId="org-1",
        tenantId="tenant-1",
        dataProductId="event-data",
        schemaVersion="1.0",
        direction="OUTBOUND",
        status="VALIDATED",
    )
    with pytest.raises(ExchangeNotReadyError):
        assert_exchange_ready_for_ingestion(exchange)


def test_assert_exchange_ready_rejects_unready_status():
    exchange = ExchangeReady(
        exchangeId="exc-1",
        organizationId="org-1",
        tenantId="tenant-1",
        dataProductId="event-data",
        schemaVersion="1.0",
        direction="INBOUND",
        status="PENDING_UPLOAD",
    )
    with pytest.raises(ExchangeNotReadyError):
        assert_exchange_ready_for_ingestion(exchange)


def test_assert_exchange_ready_accepts_validated_and_queued():
    for status in ("VALIDATED", "QUEUED_FOR_INGESTION"):
        exchange = ExchangeReady(
            exchangeId="exc-1",
            organizationId="org-1",
            tenantId="tenant-1",
            dataProductId="event-data",
            schemaVersion="1.0",
            direction="INBOUND",
            status=status,
        )
        assert_exchange_ready_for_ingestion(exchange)  # should not raise


def test_manifest_ownership_mismatch_rejected():
    manifest = parse_manifest(
        _valid_manifest_dict(), storage_bucket="b", storage_key="k"
    )
    exchange = ExchangeReady(
        exchangeId="exc-1",
        organizationId="org-DIFFERENT",
        tenantId="tenant-1",
        dataProductId="event-data",
        schemaVersion="1.0",
        direction="INBOUND",
        status="VALIDATED",
    )
    with pytest.raises(ManifestValidationError):
        assert_manifest_matches_exchange(manifest, exchange)
