from __future__ import annotations

from dataclasses import dataclass

import pytest

from lakehouse.common.errors import BronzeNotReadyError, SilverNotReadyError
from lakehouse.pipelines.pipeline_context import resolve_bronze_ready, resolve_silver_ready
from lakehouse.pipelines.pipeline_status import PipelineStatus, PipelineType


@dataclass
class _FakeIngestionRun:
    ingestion_id: str
    exchange_id: str = "exc-1"
    organization_id: str = "org-A"
    tenant_id: str = "tenant-A"
    data_product_id: str = "event-data"
    bronze_table: str = "bronze.event_data"
    schema_version: str = "1.0"
    status: str = "COMPLETED"


class _FakeIngestionRepo:
    def __init__(self, run=None):
        self._run = run

    def get(self, ingestion_id):
        return self._run


@dataclass
class _FakeSnapshot:
    snapshot_id: int = 12345


class _FakeTable:
    def current_snapshot(self):
        return _FakeSnapshot()


class _FakeCatalog:
    def load_table(self, name):
        return _FakeTable()


def test_resolve_bronze_ready_from_completed_ingestion():
    run = _FakeIngestionRun(ingestion_id="ing-1")
    ctx = resolve_bronze_ready(_FakeIngestionRepo(run), _FakeCatalog(), ingestion_id="ing-1")
    assert ctx.organization_id == "org-A"
    assert ctx.tenant_id == "tenant-A"
    assert ctx.bronze_snapshot_id == "12345"


def test_resolve_bronze_ready_raises_when_ingestion_missing():
    with pytest.raises(BronzeNotReadyError):
        resolve_bronze_ready(_FakeIngestionRepo(None), _FakeCatalog(), ingestion_id="ing-missing")


def test_resolve_bronze_ready_raises_when_not_completed():
    run = _FakeIngestionRun(ingestion_id="ing-1", status="FAILED")
    with pytest.raises(BronzeNotReadyError):
        resolve_bronze_ready(_FakeIngestionRepo(run), _FakeCatalog(), ingestion_id="ing-1")


@dataclass
class _FakePipelineRun:
    pipeline_run_id: str
    organization_id: str = "org-A"
    tenant_id: str = "tenant-A"
    target_table: str = "silver.event"
    target_snapshot_id: str = "999"
    source_exchange_id: str = "exc-1"
    source_ingestion_id: str = "ing-1"
    pipeline_type: str = PipelineType.BRONZE_TO_SILVER.value
    status: str = PipelineStatus.COMPLETED.value


class _FakePipelineRepo:
    def __init__(self, run=None):
        self._run = run

    def get(self, pipeline_run_id):
        return self._run


def test_resolve_silver_ready_from_completed_run():
    run = _FakePipelineRun(pipeline_run_id="run-1")
    ctx = resolve_silver_ready(_FakePipelineRepo(run), silver_pipeline_run_id="run-1")
    assert ctx.silver_table == "silver.event"
    assert ctx.organization_id == "org-A"


def test_resolve_silver_ready_raises_when_wrong_pipeline_type():
    run = _FakePipelineRun(pipeline_run_id="run-1", pipeline_type=PipelineType.SILVER_TO_GOLD.value)
    with pytest.raises(SilverNotReadyError):
        resolve_silver_ready(_FakePipelineRepo(run), silver_pipeline_run_id="run-1")


def test_resolve_silver_ready_raises_when_not_completed():
    run = _FakePipelineRun(pipeline_run_id="run-1", status=PipelineStatus.FAILED.value)
    with pytest.raises(SilverNotReadyError):
        resolve_silver_ready(_FakePipelineRepo(run), silver_pipeline_run_id="run-1")
