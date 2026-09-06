"""Phase 3 Bronze->Silver->Gold integration tests (AGENTS.md sections 53-57).

Each test uses `phase3_registration` for an isolated throwaway Bronze/
Silver/Gold table set (see conftest.py) so runs never collide with each
other or with manually-run demo data in silver.event/gold.event_performance.
"""

from __future__ import annotations

from decimal import Decimal

from lakehouse.catalog.iceberg import scan_tenant_scoped
from lakehouse.pipelines.pipeline_runner import run_bronze_to_silver, run_silver_to_gold
from lakehouse.pipelines.pipeline_status import PipelineStatus

from .conftest import requires_local_stack


def _csv(*rows: tuple[str, str, str, int, float]) -> bytes:
    header = b"event_id,venue_id,event_date,tickets_sold,gross_revenue\n"
    lines = [
        f"{event_id},{venue_id},{event_date},{tickets},{revenue}\n".encode()
        for event_id, venue_id, event_date, tickets, revenue in rows
    ]
    return header + b"".join(lines)


def _ingest(service, stage_exchange, *, exchange_id, org, tenant, data_product_id, csv_bytes):
    stage_exchange(
        exchange_id=exchange_id,
        organization_id=org,
        tenant_id=tenant,
        data_product_id=data_product_id,
        file_bytes=csv_bytes,
        filename="events.csv",
        fmt="CSV",
    )
    outcome = service.run(exchange_id)
    assert outcome.status.value == "COMPLETED"
    return outcome.ingestion_id


def _read_silver(catalog, table_name, org, tenant):
    table = catalog.load_table(table_name)
    return scan_tenant_scoped(
        table, organization_id=org, tenant_id=tenant, org_column="organization_id", tenant_column="tenant_id"
    ).to_arrow().to_pylist()


def _read_gold(catalog, table_name, org, tenant):
    table = catalog.load_table(table_name)
    return scan_tenant_scoped(
        table, organization_id=org, tenant_id=tenant, org_column="organization_id", tenant_column="tenant_id"
    ).to_arrow().to_pylist()


@requires_local_stack
def test_bronze_to_silver_produces_canonical_typed_records(
    service, catalog, settings, storage, engine, data_product, stage_exchange, phase3_registration, unique_id
):
    data_product_id = phase3_registration["data_product_id"]
    ingestion_id = _ingest(
        service, stage_exchange,
        exchange_id=f"exc-{unique_id}-b2s",
        org="org-test-1", tenant="tenant-test-1",
        data_product_id=data_product_id,
        csv_bytes=_csv(("EVT1001", "VEN001", "2026-09-01", 1200, 84000.00)),
    )

    outcome = run_bronze_to_silver(
        ingestion_id=ingestion_id, catalog=catalog, settings=settings, storage=storage, engine=engine
    )
    assert outcome.status == PipelineStatus.COMPLETED.value
    assert outcome.output_record_count == 1

    rows = _read_silver(catalog, phase3_registration["silver_table"], "org-test-1", "tenant-test-1")
    assert len(rows) == 1
    assert rows[0]["event_id"] == "EVT1001"
    assert rows[0]["tickets_sold"] == 1200
    assert rows[0]["gross_revenue"] == Decimal("84000.00")
    assert rows[0]["pipeline_run_id"] == outcome.pipeline_run_id


@requires_local_stack
def test_full_bronze_to_gold_computes_revenue_per_ticket(
    service, catalog, settings, storage, engine, data_product, stage_exchange, phase3_registration, unique_id
):
    data_product_id = phase3_registration["data_product_id"]
    gold_product_id = phase3_registration["gold_product_id"]
    ingestion_id = _ingest(
        service, stage_exchange,
        exchange_id=f"exc-{unique_id}-full",
        org="org-test-1", tenant="tenant-test-1",
        data_product_id=data_product_id,
        csv_bytes=_csv(("EVT2001", "VEN001", "2026-09-01", 1000, 50000.00)),
    )

    silver_outcome = run_bronze_to_silver(
        ingestion_id=ingestion_id, catalog=catalog, settings=settings, storage=storage, engine=engine
    )
    gold_outcome = run_silver_to_gold(
        silver_pipeline_run_id=silver_outcome.pipeline_run_id,
        product_id=gold_product_id,
        catalog=catalog,
        settings=settings,
        engine=engine,
    )
    assert gold_outcome.status == PipelineStatus.COMPLETED.value

    rows = _read_gold(catalog, phase3_registration["gold_table"], "org-test-1", "tenant-test-1")
    assert len(rows) == 1
    assert rows[0]["revenue_per_ticket"] == Decimal("50.00")
    assert rows[0]["_silver_pipeline_run_id"] == silver_outcome.pipeline_run_id


@requires_local_stack
def test_duplicate_ingestion_is_skipped_not_reprocessed(
    service, catalog, settings, storage, engine, data_product, stage_exchange, phase3_registration, unique_id
):
    data_product_id = phase3_registration["data_product_id"]
    ingestion_id = _ingest(
        service, stage_exchange,
        exchange_id=f"exc-{unique_id}-dup",
        org="org-test-1", tenant="tenant-test-1",
        data_product_id=data_product_id,
        csv_bytes=_csv(("EVT3001", "VEN001", "2026-09-01", 500, 25000.00)),
    )

    first = run_bronze_to_silver(
        ingestion_id=ingestion_id, catalog=catalog, settings=settings, storage=storage, engine=engine
    )
    second = run_bronze_to_silver(
        ingestion_id=ingestion_id, catalog=catalog, settings=settings, storage=storage, engine=engine
    )
    assert first.status == PipelineStatus.COMPLETED.value
    assert second.status == PipelineStatus.SKIPPED_DUPLICATE.value
    assert second.pipeline_run_id == first.pipeline_run_id


@requires_local_stack
def test_reprocess_forces_new_run_without_deleting_history(
    service, catalog, settings, storage, engine, pipeline_repo, data_product, stage_exchange, phase3_registration, unique_id
):
    data_product_id = phase3_registration["data_product_id"]
    ingestion_id = _ingest(
        service, stage_exchange,
        exchange_id=f"exc-{unique_id}-reprocess",
        org="org-test-1", tenant="tenant-test-1",
        data_product_id=data_product_id,
        csv_bytes=_csv(("EVT4001", "VEN001", "2026-09-01", 500, 25000.00)),
    )

    first = run_bronze_to_silver(
        ingestion_id=ingestion_id, catalog=catalog, settings=settings, storage=storage, engine=engine
    )
    second = run_bronze_to_silver(
        ingestion_id=ingestion_id, catalog=catalog, settings=settings, storage=storage, engine=engine, reprocess=True
    )
    assert second.status == PipelineStatus.COMPLETED.value
    assert second.pipeline_run_id != first.pipeline_run_id

    # Both runs remain in the audit history.
    assert pipeline_repo.get(first.pipeline_run_id) is not None
    assert pipeline_repo.get(second.pipeline_run_id) is not None


@requires_local_stack
def test_updated_event_upserts_silver_and_recomputes_gold_incrementally(
    service, catalog, settings, storage, engine, data_product, stage_exchange, phase3_registration, unique_id
):
    data_product_id = phase3_registration["data_product_id"]
    gold_product_id = phase3_registration["gold_product_id"]
    org, tenant = "org-test-1", "tenant-test-1"

    ingestion_1 = _ingest(
        service, stage_exchange,
        exchange_id=f"exc-{unique_id}-initial",
        org=org, tenant=tenant,
        data_product_id=data_product_id,
        csv_bytes=_csv(
            ("EVT5001", "VEN001", "2026-09-01", 1000, 50000.00),
            ("EVT5002", "VEN002", "2026-09-02", 800, 40000.00),
        ),
    )
    silver_1 = run_bronze_to_silver(
        ingestion_id=ingestion_1, catalog=catalog, settings=settings, storage=storage, engine=engine
    )
    run_silver_to_gold(
        silver_pipeline_run_id=silver_1.pipeline_run_id, product_id=gold_product_id,
        catalog=catalog, settings=settings, engine=engine,
    )

    ingestion_2 = _ingest(
        service, stage_exchange,
        exchange_id=f"exc-{unique_id}-update",
        org=org, tenant=tenant,
        data_product_id=data_product_id,
        csv_bytes=_csv(("EVT5001", "VEN001", "2026-09-01", 1200, 84000.00)),
    )
    silver_2 = run_bronze_to_silver(
        ingestion_id=ingestion_2, catalog=catalog, settings=settings, storage=storage, engine=engine
    )
    assert silver_2.output_record_count == 1  # only the affected event, not a full rebuild
    run_silver_to_gold(
        silver_pipeline_run_id=silver_2.pipeline_run_id, product_id=gold_product_id,
        catalog=catalog, settings=settings, engine=engine,
    )

    silver_rows = {r["event_id"]: r for r in _read_silver(catalog, phase3_registration["silver_table"], org, tenant)}
    assert silver_rows["EVT5001"]["tickets_sold"] == 1200
    assert silver_rows["EVT5002"]["tickets_sold"] == 800  # unchanged

    gold_rows = {r["event_id"]: r for r in _read_gold(catalog, phase3_registration["gold_table"], org, tenant)}
    assert gold_rows["EVT5001"]["revenue_per_ticket"] == Decimal("70.00")
    assert gold_rows["EVT5002"]["revenue_per_ticket"] == Decimal("50.00")  # unchanged


@requires_local_stack
def test_bad_record_is_quarantined_not_written_and_pipeline_still_completes(
    service, catalog, settings, storage, engine, pipeline_repo, data_product, stage_exchange, phase3_registration, unique_id
):
    data_product_id = phase3_registration["data_product_id"]
    ingestion_id = _ingest(
        service, stage_exchange,
        exchange_id=f"exc-{unique_id}-bad",
        org="org-test-1", tenant="tenant-test-1",
        data_product_id=data_product_id,
        csv_bytes=_csv(
            ("EVT_BAD", "VEN099", "2026-09-15", -5, 1000.00),
            ("EVT_GOOD", "VEN099", "2026-09-15", 100, 5000.00),
        ),
    )

    outcome = run_bronze_to_silver(
        ingestion_id=ingestion_id, catalog=catalog, settings=settings, storage=storage, engine=engine
    )
    assert outcome.status == PipelineStatus.COMPLETED.value
    assert outcome.output_record_count == 1
    assert outcome.rejected_record_count == 1

    rows = _read_silver(catalog, phase3_registration["silver_table"], "org-test-1", "tenant-test-1")
    assert {r["event_id"] for r in rows} == {"EVT_GOOD"}

    from lakehouse.pipelines.pipeline_status import PipelineType

    _ = PipelineType  # (imported for readability in assertions below)
    run_record = pipeline_repo.get(outcome.pipeline_run_id)
    assert run_record.status == PipelineStatus.COMPLETED.value  # quarantine != pipeline failure


@requires_local_stack
def test_two_tenants_with_same_event_id_remain_isolated_in_silver_and_gold(
    service, catalog, settings, storage, engine, data_product, stage_exchange, phase3_registration, unique_id
):
    data_product_id = phase3_registration["data_product_id"]
    gold_product_id = phase3_registration["gold_product_id"]

    ingestion_a = _ingest(
        service, stage_exchange,
        exchange_id=f"exc-{unique_id}-tenant-a",
        org="org-A", tenant="tenant-A",
        data_product_id=data_product_id,
        csv_bytes=_csv(("EVT6001", "VEN-A", "2026-09-01", 100, 1000.00)),
    )
    ingestion_b = _ingest(
        service, stage_exchange,
        exchange_id=f"exc-{unique_id}-tenant-b",
        org="org-B", tenant="tenant-B",
        data_product_id=data_product_id,
        csv_bytes=_csv(("EVT6001", "VEN-B", "2026-09-01", 500, 25000.00)),
    )

    silver_a = run_bronze_to_silver(ingestion_id=ingestion_a, catalog=catalog, settings=settings, storage=storage, engine=engine)
    silver_b = run_bronze_to_silver(ingestion_id=ingestion_b, catalog=catalog, settings=settings, storage=storage, engine=engine)
    run_silver_to_gold(silver_pipeline_run_id=silver_a.pipeline_run_id, product_id=gold_product_id, catalog=catalog, settings=settings, engine=engine)
    run_silver_to_gold(silver_pipeline_run_id=silver_b.pipeline_run_id, product_id=gold_product_id, catalog=catalog, settings=settings, engine=engine)

    silver_rows_a = _read_silver(catalog, phase3_registration["silver_table"], "org-A", "tenant-A")
    silver_rows_b = _read_silver(catalog, phase3_registration["silver_table"], "org-B", "tenant-B")
    assert {r["event_id"] for r in silver_rows_a} == {"EVT6001"}
    assert {r["event_id"] for r in silver_rows_b} == {"EVT6001"}
    assert silver_rows_a[0]["venue_id"] == "VEN-A"
    assert silver_rows_b[0]["venue_id"] == "VEN-B"
    assert not any(r["tenant_id"] == "tenant-B" for r in silver_rows_a)
    assert not any(r["tenant_id"] == "tenant-A" for r in silver_rows_b)

    gold_rows_a = _read_gold(catalog, phase3_registration["gold_table"], "org-A", "tenant-A")
    gold_rows_b = _read_gold(catalog, phase3_registration["gold_table"], "org-B", "tenant-B")
    assert gold_rows_a[0]["revenue_per_ticket"] == Decimal("10.00")
    assert gold_rows_b[0]["revenue_per_ticket"] == Decimal("50.00")
    assert not any(r["tenant_id"] == "tenant-B" for r in gold_rows_a)
    assert not any(r["tenant_id"] == "tenant-A" for r in gold_rows_b)


@requires_local_stack
def test_quality_results_are_persisted_for_each_run(
    service, catalog, settings, storage, engine, pipeline_repo, data_product, stage_exchange, phase3_registration, unique_id
):
    data_product_id = phase3_registration["data_product_id"]
    ingestion_id = _ingest(
        service, stage_exchange,
        exchange_id=f"exc-{unique_id}-quality",
        org="org-test-1", tenant="tenant-test-1",
        data_product_id=data_product_id,
        csv_bytes=_csv(("EVT7001", "VEN001", "2026-09-01", 100, 5000.00)),
    )
    outcome = run_bronze_to_silver(
        ingestion_id=ingestion_id, catalog=catalog, settings=settings, storage=storage, engine=engine
    )

    import sqlalchemy as sa

    with engine.connect() as conn:
        rows = conn.execute(
            sa.text("SELECT rule_name, passed FROM lakehouse.quality_results WHERE pipeline_run_id = :id"),
            {"id": outcome.pipeline_run_id},
        ).mappings().all()
    assert len(rows) >= 5
    assert all(r["passed"] for r in rows)
