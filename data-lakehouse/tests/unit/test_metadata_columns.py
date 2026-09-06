from __future__ import annotations

from datetime import datetime

from lakehouse.bronze.lineage import attach_lineage
from lakehouse.bronze.metadata_columns import METADATA_COLUMNS
from lakehouse.exchange.manifest import parse_manifest
from lakehouse.exchange.models import ExchangeReady
from lakehouse.ingestion.ingestion_context import IngestionContext


def _context_and_manifest():
    raw = {
        "manifestVersion": "1.0",
        "exchange": {"exchangeId": "exc-1", "direction": "INBOUND", "status": "VALIDATED"},
        "ownership": {"organizationId": "org-1", "tenantId": "tenant-1"},
        "dataProduct": {"dataProductId": "event-data", "schemaVersion": "1.0"},
        "file": {"originalFilename": "events.csv", "format": "CSV", "sizeBytes": 10},
        "source": {"channel": "CUSTOMER_PORTAL"},
    }
    manifest = parse_manifest(raw, storage_bucket="exchange-inbound", storage_key="exchanges/exc-1/events.csv")
    exchange = ExchangeReady(
        exchangeId="exc-1",
        organizationId="org-1",
        tenantId="tenant-1",
        dataProductId="event-data",
        schemaVersion="1.0",
        direction="INBOUND",
        status="VALIDATED",
    )
    context = IngestionContext.create(ingestion_id="ing-1", exchange=exchange, manifest=manifest)
    return context, manifest


def test_attach_lineage_adds_every_required_metadata_column():
    context, manifest = _context_and_manifest()
    record = attach_lineage(
        {"event_id": "EVT1"},
        context=context,
        manifest=manifest,
        row_number=1,
        ingested_at=datetime(2026, 9, 5),
    )
    for col in METADATA_COLUMNS:
        assert col in record, f"missing required metadata column {col}"
    assert record["event_id"] == "EVT1"  # business column untouched
    assert record["_organization_id"] == "org-1"
    assert record["_tenant_id"] == "tenant-1"
    assert record["_source_row_number"] == 1


def test_attach_lineage_never_renames_business_columns():
    context, manifest = _context_and_manifest()
    business = {"event_id": "EVT1", "venue_id": "VEN1"}
    record = attach_lineage(
        business, context=context, manifest=manifest, row_number=1, ingested_at=datetime.now()
    )
    for key, value in business.items():
        assert record[key] == value
