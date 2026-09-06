from __future__ import annotations

from dataclasses import dataclass

from lakehouse.pipelines.idempotency import check_pipeline_idempotency


@dataclass
class _FakeRun:
    pipeline_run_id: str
    output_record_count: int = 3
    rejected_record_count: int = 0


class _FakeRepo:
    def __init__(self, existing=None):
        self._existing = existing

    def find_successful_run(self, **kwargs):
        return self._existing


def test_no_previous_run_does_not_skip():
    decision = check_pipeline_idempotency(
        _FakeRepo(existing=None),
        pipeline_name="event-bronze-to-silver",
        organization_id="org-A",
        tenant_id="tenant-A",
        source_ingestion_id="ing-1",
        source_pipeline_run_id=None,
        pipeline_version="1.0",
        contract_version="1.0",
        mapping_version="1.0",
        reprocess=False,
    )
    assert decision.should_skip is False


def test_previous_successful_run_causes_skip():
    existing = _FakeRun(pipeline_run_id="run-prev")
    decision = check_pipeline_idempotency(
        _FakeRepo(existing=existing),
        pipeline_name="event-bronze-to-silver",
        organization_id="org-A",
        tenant_id="tenant-A",
        source_ingestion_id="ing-1",
        source_pipeline_run_id=None,
        pipeline_version="1.0",
        contract_version="1.0",
        mapping_version="1.0",
        reprocess=False,
    )
    assert decision.should_skip is True
    assert decision.existing_run is existing


def test_reprocess_flag_bypasses_skip_even_with_existing_run():
    existing = _FakeRun(pipeline_run_id="run-prev")
    decision = check_pipeline_idempotency(
        _FakeRepo(existing=existing),
        pipeline_name="event-bronze-to-silver",
        organization_id="org-A",
        tenant_id="tenant-A",
        source_ingestion_id="ing-1",
        source_pipeline_run_id=None,
        pipeline_version="1.0",
        contract_version="1.0",
        mapping_version="1.0",
        reprocess=True,
    )
    assert decision.should_skip is False
