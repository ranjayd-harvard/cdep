from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request
from pyiceberg.exceptions import NoSuchTableError

from lakehouse.api.auth import require_internal_api_key
from lakehouse.api.schemas import (
    DataProductOut,
    IngestionOutcomeOut,
    IngestionRunOut,
    LineageEdgeOut,
    PipelineOutcomeOut,
    PipelineRunDetailOut,
    PipelineRunOut,
    QualityResultOut,
    TriggerBronzeToSilverIn,
    TriggerIngestionIn,
    TriggerSilverToGoldIn,
)
from lakehouse.catalog.catalog import get_catalog
from lakehouse.common.errors import LakehouseError, PipelineRunNotFoundError
from lakehouse.config.settings import get_settings
from lakehouse.gold.gold_reader import read_gold_admin
from lakehouse.ingestion.ingestion_repository import (
    IngestionRepository,
    IngestionRun,
    get_engine,
)
from lakehouse.ingestion.ingestion_service import IngestionOutcome
from lakehouse.lineage.lineage_service import LineageService
from lakehouse.pipelines.data_product_repository import DataProduct, DataProductRepository
from lakehouse.pipelines.pipeline_repository import PipelineRepository, PipelineRun
from lakehouse.pipelines.pipeline_runner import (
    PipelineOutcome,
    run_bronze_to_silver,
    run_silver_to_gold,
)
from lakehouse.pipelines.pipeline_status import PipelineType
from lakehouse.pipelines.registry import BRONZE_TO_SILVER_PIPELINES, SILVER_TO_GOLD_PIPELINES
from lakehouse.quality.engine import list_quality_results
from lakehouse.storage import build_storage_client

router = APIRouter(dependencies=[Depends(require_internal_api_key)])


def _run_out(run: IngestionRun) -> IngestionRunOut:
    return IngestionRunOut(
        ingestion_id=run.ingestion_id,
        exchange_id=run.exchange_id,
        organization_id=run.organization_id,
        tenant_id=run.tenant_id,
        data_product_id=run.data_product_id,
        schema_version=run.schema_version,
        bronze_table=run.bronze_table,
        status=run.status,
        started_at=run.started_at,
        completed_at=run.completed_at,
        source_record_count=run.source_record_count,
        bronze_record_count=run.bronze_record_count,
        rejected_record_count=run.rejected_record_count,
        error_code=run.error_code,
        error_message=run.error_message,
        created_at=run.created_at,
    )


def _outcome_out(outcome: IngestionOutcome) -> IngestionOutcomeOut:
    return IngestionOutcomeOut(
        ingestion_id=outcome.ingestion_id,
        exchange_id=outcome.exchange_id,
        status=outcome.status.value,
        bronze_table=outcome.bronze_table,
        source_record_count=outcome.source_record_count,
        bronze_record_count=outcome.bronze_record_count,
        rejected_record_count=outcome.rejected_record_count,
        error_code=outcome.error_code,
        error_message=outcome.error_message,
    )


@router.get("/internal/v1/ingestion-runs", response_model=list[IngestionRunOut])
def list_ingestion_runs(exchange_id: str | None = None, limit: int = 50) -> list[IngestionRunOut]:
    repo = IngestionRepository()
    runs = repo.list_by_exchange(exchange_id) if exchange_id else repo.list_recent(limit)
    return [_run_out(r) for r in runs]


@router.post("/internal/v1/ingestion-runs", response_model=IngestionOutcomeOut)
def trigger_ingestion(body: TriggerIngestionIn, request: Request) -> IngestionOutcomeOut:
    service = request.app.state.ingestion_service
    try:
        outcome = service.run(body.exchange_id)
    except LakehouseError as exc:
        # ExchangeNotFoundError -> 404 (nothing to ingest); every other
        # LakehouseError raised before an ingestion_runs row exists (e.g.
        # ExchangeNotReadyError, ManifestValidationError) -> 409, a
        # client-fixable precondition failure, not a server bug. Note: a
        # failure *inside* IngestionService._execute (after the row is
        # created) is NOT an exception here -- service.run() already caught
        # it and returns a normal IngestionOutcome with status=FAILED, a
        # 200 response, so the failure is visible in the response body
        # rather than as an HTTP error.
        status_code = 404 if exc.error_code == "EXCHANGE_NOT_FOUND" else 409
        raise HTTPException(
            status_code=status_code,
            detail={"error_code": exc.error_code, "message": exc.message},
        ) from exc
    return _outcome_out(outcome)


# ---------------------------------------------------------------------------
# Phase 3: pipeline runs (Bronze->Silver / Silver->Gold).
# ---------------------------------------------------------------------------


def _pipeline_run_out(run: PipelineRun) -> PipelineRunOut:
    return PipelineRunOut(
        pipeline_run_id=run.pipeline_run_id,
        pipeline_name=run.pipeline_name,
        pipeline_type=run.pipeline_type,
        organization_id=run.organization_id,
        tenant_id=run.tenant_id,
        source_table=run.source_table,
        target_table=run.target_table,
        source_exchange_id=run.source_exchange_id,
        source_ingestion_id=run.source_ingestion_id,
        source_pipeline_run_id=run.source_pipeline_run_id,
        data_product_id=run.data_product_id,
        pipeline_version=run.pipeline_version,
        contract_version=run.contract_version,
        mapping_version=run.mapping_version,
        source_snapshot_id=run.source_snapshot_id,
        target_snapshot_id=run.target_snapshot_id,
        status=run.status,
        input_record_count=run.input_record_count,
        output_record_count=run.output_record_count,
        rejected_record_count=run.rejected_record_count,
        started_at=run.started_at,
        completed_at=run.completed_at,
        error_code=run.error_code,
        error_message=run.error_message,
        created_at=run.created_at,
    )


def _pipeline_outcome_out(outcome: PipelineOutcome) -> PipelineOutcomeOut:
    return PipelineOutcomeOut(
        pipeline_run_id=outcome.pipeline_run_id,
        pipeline_type=outcome.pipeline_type,
        status=outcome.status,
        source_table=outcome.source_table,
        target_table=outcome.target_table,
        input_record_count=outcome.input_record_count,
        output_record_count=outcome.output_record_count,
        rejected_record_count=outcome.rejected_record_count,
        error_code=outcome.error_code,
        error_message=outcome.error_message,
    )


def _data_product_out(product: DataProduct) -> DataProductOut:
    return DataProductOut(
        data_product_id=product.data_product_id,
        display_name=product.display_name,
        version=product.version,
        gold_table=product.gold_table,
        owner=product.owner,
        description=product.description,
        status=product.status,
    )


@router.get("/internal/v1/pipeline-runs", response_model=list[PipelineRunOut])
def list_pipeline_runs(
    ingestion_id: str | None = None,
    source_pipeline_run_id: str | None = None,
    limit: int = 50,
) -> list[PipelineRunOut]:
    repo = PipelineRepository(get_engine())
    if ingestion_id:
        runs = repo.list_by_source_ingestion(ingestion_id)
    elif source_pipeline_run_id:
        runs = repo.list_by_source_pipeline_run(source_pipeline_run_id)
    else:
        runs = repo.list_recent(limit)
    return [_pipeline_run_out(r) for r in runs]


@router.get("/internal/v1/pipeline-runs/{pipeline_run_id}", response_model=PipelineRunDetailOut)
def get_pipeline_run(pipeline_run_id: str) -> PipelineRunDetailOut:
    engine = get_engine()
    repo = PipelineRepository(engine)
    run = repo.get(pipeline_run_id)
    if run is None:
        raise HTTPException(status_code=404, detail={"error_code": "PIPELINE_RUN_NOT_FOUND"})

    quality_results = [
        QualityResultOut(**row) for row in list_quality_results(engine, pipeline_run_id=pipeline_run_id)
    ]

    target_type = "silver_table" if run.pipeline_type == PipelineType.BRONZE_TO_SILVER.value else "gold_table"
    target_identifier = f"{run.target_table}@{run.target_snapshot_id}"
    lineage = LineageService(engine).upstream_of(target_type=target_type, target_identifier=target_identifier)
    lineage_edges = [
        LineageEdgeOut(
            source_type=e.source_type,
            source_identifier=e.source_identifier,
            target_type=e.target_type,
            target_identifier=e.target_identifier,
            created_at=e.created_at,
        )
        for e in lineage
        if e.pipeline_run_id == pipeline_run_id
    ]

    return PipelineRunDetailOut(
        run=_pipeline_run_out(run), quality_results=quality_results, lineage_edges=lineage_edges
    )


@router.post("/internal/v1/pipeline-runs/bronze-to-silver", response_model=PipelineOutcomeOut)
def trigger_bronze_to_silver(body: TriggerBronzeToSilverIn) -> PipelineOutcomeOut:
    settings = get_settings()
    try:
        outcome = run_bronze_to_silver(
            ingestion_id=body.ingestion_id,
            catalog=get_catalog(),
            settings=settings,
            storage=build_storage_client(settings),
            engine=get_engine(),
            reprocess=body.reprocess,
        )
    except LakehouseError as exc:
        # BronzeNotReadyError / PipelineNotConfiguredError -> the ingestion_id
        # given isn't eligible for Bronze->Silver yet (client-fixable
        # precondition, not a server bug) -> 409, same pattern as
        # trigger_ingestion above. A failure *inside* the pipeline (after its
        # run row is created) is not an exception -- it's a normal 200 with
        # status=FAILED in the body.
        raise HTTPException(
            status_code=409, detail={"error_code": exc.error_code, "message": exc.message}
        ) from exc
    return _pipeline_outcome_out(outcome)


@router.post("/internal/v1/pipeline-runs/silver-to-gold", response_model=list[PipelineOutcomeOut])
def trigger_silver_to_gold(body: TriggerSilverToGoldIn) -> list[PipelineOutcomeOut]:
    settings = get_settings()
    catalog = get_catalog()
    engine = get_engine()

    if body.product_id:
        product_ids = [body.product_id]
    else:
        run = PipelineRepository(engine).get(body.silver_run_id)
        if run is None:
            raise HTTPException(
                status_code=404, detail={"error_code": PipelineRunNotFoundError.error_code}
            )
        registration = BRONZE_TO_SILVER_PIPELINES.get(run.data_product_id or "")
        product_ids = registration.gold_products if registration else []
        if not product_ids:
            raise HTTPException(
                status_code=409,
                detail={
                    "error_code": "PIPELINE_NOT_CONFIGURED",
                    "message": f"No Gold products registered for Bronze data product "
                    f"'{run.data_product_id}'",
                },
            )

    outcomes: list[PipelineOutcomeOut] = []
    for product_id in product_ids:
        try:
            outcome = run_silver_to_gold(
                silver_pipeline_run_id=body.silver_run_id,
                product_id=product_id,
                catalog=catalog,
                settings=settings,
                engine=engine,
                reprocess=body.reprocess,
            )
        except LakehouseError as exc:
            raise HTTPException(
                status_code=409, detail={"error_code": exc.error_code, "message": exc.message}
            ) from exc
        outcomes.append(_pipeline_outcome_out(outcome))
    return outcomes


@router.get("/internal/v1/data-products", response_model=list[DataProductOut])
def list_data_products() -> list[DataProductOut]:
    products = DataProductRepository(get_engine()).list_all()
    return [_data_product_out(p) for p in products]


@router.get("/internal/v1/data-products/{product_id}/rows")
def get_data_product_rows(product_id: str, limit: int = 100) -> list[dict]:
    """Cross-tenant read for this superadmin-only console (AGENTS.md section
    26's sanctioned privileged-tooling carve-out) -- the portal's
    `/admin/lakehouse` already shows exchanges across every tenant the same
    way."""
    registration = SILVER_TO_GOLD_PIPELINES.get(product_id)
    if registration is None:
        raise HTTPException(status_code=404, detail={"error_code": "DATA_PRODUCT_NOT_CONFIGURED"})

    try:
        rows = read_gold_admin(get_catalog(), table_name=registration.gold_table_name)
    except NoSuchTableError:
        # Registered in lakehouse.data_products but no Silver->Gold run has
        # ever written its Iceberg table yet -- the portal's Data Products
        # page already renders this as "No rows yet -- run Silver -> Gold"
        # for an empty list, so this is that same state, not an error.
        return []
    return _json_safe(rows[:limit])


def _json_safe(rows: list[dict]) -> list[dict]:
    import datetime as dt
    from decimal import Decimal

    def convert(value):
        if isinstance(value, Decimal):
            return str(value)
        if isinstance(value, (dt.datetime, dt.date)):
            return value.isoformat()
        return value

    return [{k: convert(v) for k, v in row.items()} for row in rows]
