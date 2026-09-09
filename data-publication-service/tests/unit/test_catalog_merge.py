"""Unit coverage for the Catalog contract merge (Phase 5 integration).
Exercises `_merge_catalog_contract` directly, with an in-memory catalog
envelope shaped exactly like data-product-catalog-service's
`GET /internal/v1/data-products/{id}/versions/{version}/contract` response
-- no network, no running Catalog service required.
"""

from publication.contracts.loader import _merge_catalog_contract

LOCAL_DATA = {
    "dataProduct": {"id": "event-performance", "name": "Event Performance", "version": "1.0", "owner": "Event Analytics"},
    "source": {"table": "gold.event_performance"},
    "grain": ["event_id"],
    "tenantScope": {"organizationColumn": "organization_id", "tenantColumn": "tenant_id"},
    "publishedSchema": [{"name": "event_id", "source": "event_id", "type": "string", "required": True}],
    "formats": ["PARQUET"],
    "defaultFormat": "PARQUET",
    "publication": {"filenamePattern": "old-{date}", "compression": {"parquet": "snappy", "csv": "gzip"}, "expirationHours": 24},
    "quality": {"verifySchema": True, "verifyRecordCount": True, "requireNonEmpty": True, "enforceGrain": True},
    "masking": {},
}

CATALOG_ENVELOPE = {
    "contract": {
        "metadata": {"id": "event-performance", "name": "Event Performance", "version": "1.1.0"},
        "spec": {
            "owner": {"id": "event-analytics", "displayName": "Event Analytics"},
            "grain": {"description": "One row per event", "keys": ["event_id"]},
            "schema": [
                {"name": "event_id", "type": "string", "required": True, "customerVisible": True},
                {"name": "venue_id", "type": "string", "required": True, "customerVisible": True},
                {"name": "internal_only", "type": "string", "required": False, "customerVisible": False},
            ],
            "delivery": {"methods": [{"type": "FILE", "enabled": True, "formats": ["PARQUET", "CSV"]}]},
            "publication": {"defaultFormat": "PARQUET", "filenamePattern": "event-performance-{date}-{publicationId}", "expirationHours": 168},
        },
    }
}


def test_merge_takes_schema_and_publication_settings_from_catalog():
    merged = _merge_catalog_contract(LOCAL_DATA, CATALOG_ENVELOPE)

    assert merged["dataProduct"]["version"] == "1.1.0"
    assert [c["name"] for c in merged["publishedSchema"]] == ["event_id", "venue_id"]
    assert merged["formats"] == ["PARQUET", "CSV"]
    assert merged["publication"]["filenamePattern"] == "event-performance-{date}-{publicationId}"
    assert merged["publication"]["expirationHours"] == 168


def test_merge_keeps_physical_wiring_from_local_yaml():
    merged = _merge_catalog_contract(LOCAL_DATA, CATALOG_ENVELOPE)

    # source.table / tenantScope / masking / compression are Gold-physical
    # wiring the Catalog deliberately doesn't own (spec §33/§63).
    assert merged["source"]["table"] == "gold.event_performance"
    assert merged["tenantScope"] == LOCAL_DATA["tenantScope"]
    assert merged["publication"]["compression"] == {"parquet": "snappy", "csv": "gzip"}
    assert merged["quality"] == LOCAL_DATA["quality"]


def test_merge_excludes_internal_only_fields():
    merged = _merge_catalog_contract(LOCAL_DATA, CATALOG_ENVELOPE)
    assert "internal_only" not in {c["name"] for c in merged["publishedSchema"]}
