"""Duplicate exchange prevention and failed-ingestion retry (AGENTS.md
sections 16/36/40)."""

from __future__ import annotations

import hashlib
import json

from lakehouse.ingestion.status import IngestionStatus

from .conftest import requires_local_stack

VALID_CSV = (
    b"event_id,venue_id,event_date,tickets_sold,gross_revenue\n"
    b"EVT1,VEN1,2026-09-01,100,7000.50\n"
)
RETRY_TEST_FILE_BYTES = (
    b"event_id,venue_id,event_date,tickets_sold,gross_revenue\n"
    b"EVT9,VEN9,2026-09-09,900,9000.00\n"
)


@requires_local_stack
def test_re_ingesting_same_exchange_is_skipped_as_duplicate(
    service, data_product, stage_exchange, unique_id
):
    data_product_id, _ = data_product
    exchange_id = f"exc-{unique_id}-dup"
    stage_exchange(
        exchange_id=exchange_id,
        organization_id="org-test-1",
        tenant_id="tenant-test-1",
        data_product_id=data_product_id,
        file_bytes=VALID_CSV,
        filename="events.csv",
        fmt="CSV",
    )

    first = service.run(exchange_id)
    assert first.status == IngestionStatus.COMPLETED

    second = service.run(exchange_id)
    assert second.status == IngestionStatus.SKIPPED_DUPLICATE
    assert second.ingestion_id == first.ingestion_id
    assert second.bronze_record_count == first.bronze_record_count


@requires_local_stack
def test_failed_ingestion_can_be_retried_successfully(
    service, repo, data_product, stage_exchange, unique_id
):
    data_product_id, _ = data_product
    exchange_id = f"exc-{unique_id}-retry"

    stage_exchange(
        exchange_id=exchange_id,
        organization_id="org-test-1",
        tenant_id="tenant-test-1",
        data_product_id=data_product_id,
        file_bytes=RETRY_TEST_FILE_BYTES,
        filename="events.csv",
        fmt="CSV",
    )
    # Corrupt only the manifest's declared checksum so technical validation
    # fails deterministically (checksum mismatch) without touching the
    # object itself -- simulating "ingestion crashed/failed" cleanly.
    manifest_key = f"exchanges/{exchange_id}/manifest.json"
    storage = service._storage  # noqa: SLF001 - test-only introspection
    settings = service._settings  # noqa: SLF001
    with storage.open(settings.bucket_exchange_inbound, manifest_key) as f:
        manifest = json.loads(f.read())
    manifest["file"]["checksum"] = "0" * 64
    storage.put_bytes(
        settings.bucket_exchange_inbound,
        manifest_key,
        json.dumps(manifest).encode("utf-8"),
        "application/json",
    )

    first = service.run(exchange_id)
    assert first.status == IngestionStatus.FAILED
    assert first.error_code == "SOURCE_UNREADABLE"

    run_record = repo.get(first.ingestion_id)
    assert run_record.status == "FAILED"
    assert run_record.error_code == "SOURCE_UNREADABLE"

    # Fix the manifest (restore the correct checksum) and retry: the same
    # exchange_id succeeds on a fresh ingestion_id.
    manifest["file"]["checksum"] = hashlib.sha256(RETRY_TEST_FILE_BYTES).hexdigest()
    storage.put_bytes(
        settings.bucket_exchange_inbound,
        manifest_key,
        json.dumps(manifest).encode("utf-8"),
        "application/json",
    )

    second = service.run(exchange_id)
    assert second.status == IngestionStatus.COMPLETED
    assert second.ingestion_id != first.ingestion_id
