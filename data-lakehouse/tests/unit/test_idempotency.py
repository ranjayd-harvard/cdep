from __future__ import annotations

from dataclasses import dataclass

from lakehouse.ingestion.idempotency import check_idempotency


@dataclass
class _FakeRun:
    ingestion_id: str
    bronze_table: str = "bronze.event_data"
    source_checksum: str | None = "abc"
    source_record_count: int = 3
    bronze_record_count: int = 3
    rejected_record_count: int = 0


class _FakeRepo:
    def __init__(self, existing=None):
        self._existing = existing

    def find_successful_run(self, *, exchange_id, data_product_id, schema_version):
        return self._existing


def test_no_previous_run_does_not_skip():
    decision = check_idempotency(
        _FakeRepo(existing=None),
        exchange_id="exc-1",
        data_product_id="event-data",
        schema_version="1.0",
        source_checksum="abc",
    )
    assert decision.should_skip is False
    assert decision.existing_run is None


def test_previous_successful_run_causes_skip():
    existing = _FakeRun(ingestion_id="ing-prev")
    decision = check_idempotency(
        _FakeRepo(existing=existing),
        exchange_id="exc-1",
        data_product_id="event-data",
        schema_version="1.0",
        source_checksum="abc",
    )
    assert decision.should_skip is True
    assert decision.existing_run is existing


def test_checksum_mismatch_still_skips_but_is_detectable():
    """A checksum mismatch against a prior successful run is logged as a
    warning (same exchange_id should never carry two different files) but
    idempotency still wins -- we do not silently re-ingest."""
    existing = _FakeRun(ingestion_id="ing-prev", source_checksum="OLD")
    decision = check_idempotency(
        _FakeRepo(existing=existing),
        exchange_id="exc-1",
        data_product_id="event-data",
        schema_version="1.0",
        source_checksum="NEW",
    )
    assert decision.should_skip is True
