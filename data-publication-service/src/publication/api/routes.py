from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request

from publication.api.auth import require_internal_api_key
from publication.api.schemas import (
    PublicationArtifactOut,
    PublicationOutcomeOut,
    PublicationQualityResultOut,
    PublicationRunDetailOut,
    PublicationRunOut,
    TriggerPublishIn,
)
from publication.common.errors import PublicationError
from publication.lakehouse.gold_metadata_reader import (
    resolve_gold_ready_by_pipeline_run_id,
    resolve_latest_gold_ready_by_scope,
)
from publication.metadata.engine import get_engine
from publication.metadata.repository import PublicationRepository, PublicationRunRow
from publication.models.publication import PublicationOutcome

router = APIRouter(dependencies=[Depends(require_internal_api_key)])


def _run_out(run: PublicationRunRow) -> PublicationRunOut:
    return PublicationRunOut(
        publication_id=run.publication_id,
        organization_id=run.organization_id,
        tenant_id=run.tenant_id,
        data_product_id=run.data_product_id,
        product_version=run.product_version,
        source_gold_table=run.source_gold_table,
        source_gold_snapshot_id=run.source_gold_snapshot_id,
        source_pipeline_run_id=run.source_pipeline_run_id,
        requested_format=run.requested_format,
        status=run.status,
        input_record_count=run.input_record_count,
        output_record_count=run.output_record_count,
        artifact_count=run.artifact_count,
        outbound_exchange_id=run.outbound_exchange_id,
        started_at=run.started_at,
        completed_at=run.completed_at,
        error_code=run.error_code,
        error_message=run.error_message,
        created_at=run.created_at,
    )


def _outcome_out(outcome: PublicationOutcome) -> PublicationOutcomeOut:
    return PublicationOutcomeOut(
        publication_id=outcome.publication_id,
        status=outcome.status,
        organization_id=outcome.organization_id,
        tenant_id=outcome.tenant_id,
        data_product_id=outcome.data_product_id,
        product_version=outcome.product_version,
        source_gold_table=outcome.source_gold_table,
        source_gold_snapshot_id=outcome.source_gold_snapshot_id,
        input_record_count=outcome.input_record_count,
        output_record_count=outcome.output_record_count,
        artifact_count=outcome.artifact_count,
        outbound_exchange_id=outcome.outbound_exchange_id,
        error_code=outcome.error_code,
        error_message=outcome.error_message,
    )


@router.get("/internal/v1/publications", response_model=list[PublicationRunOut])
def list_publications(limit: int = 50) -> list[PublicationRunOut]:
    repo = PublicationRepository(get_engine())
    return [_run_out(r) for r in repo.list_recent(limit)]


@router.get("/internal/v1/publications/{publication_id}", response_model=PublicationRunDetailOut)
def get_publication(publication_id: str) -> PublicationRunDetailOut:
    repo = PublicationRepository(get_engine())
    run = repo.get(publication_id)
    if run is None:
        raise HTTPException(status_code=404, detail={"error_code": "PUBLICATION_NOT_FOUND"})

    artifacts = [PublicationArtifactOut(**a) for a in repo.list_artifacts(publication_id)]
    quality_results = [PublicationQualityResultOut(**q) for q in repo.list_quality_results(publication_id)]
    return PublicationRunDetailOut(run=_run_out(run), artifacts=artifacts, quality_results=quality_results)


@router.post("/internal/v1/publications", response_model=PublicationOutcomeOut)
def trigger_publish(body: TriggerPublishIn, request: Request) -> PublicationOutcomeOut:
    scope_fields = (body.organization_id, body.tenant_id, body.data_product_id, body.product_version)
    by_scope = any(f is not None for f in scope_fields)

    if body.pipeline_run_id and by_scope:
        raise HTTPException(
            status_code=400,
            detail={"error_code": "AMBIGUOUS_TRIGGER", "message": "Provide either pipeline_run_id or the organization/tenant/data_product/product_version scope, not both."},
        )
    if not body.pipeline_run_id and not all(f is not None for f in scope_fields):
        raise HTTPException(
            status_code=400,
            detail={
                "error_code": "INVALID_TRIGGER_REQUEST",
                "message": "Provide pipeline_run_id, or all of organization_id/tenant_id/data_product_id/product_version.",
            },
        )

    try:
        if body.pipeline_run_id:
            gold_ready = resolve_gold_ready_by_pipeline_run_id(body.pipeline_run_id)
        else:
            gold_ready = resolve_latest_gold_ready_by_scope(
                organization_id=body.organization_id,  # type: ignore[arg-type]
                tenant_id=body.tenant_id,  # type: ignore[arg-type]
                data_product_id=body.data_product_id,  # type: ignore[arg-type]
                product_version=body.product_version,  # type: ignore[arg-type]
            )
    except PublicationError as exc:
        # GoldReadyNotFoundError -> no COMPLETED SILVER_TO_GOLD run exists
        # yet for the given identifier/scope (client-fixable precondition,
        # not a server bug) -- 404, mirroring data-lakehouse's
        # trigger_ingestion/trigger_bronze_to_silver precedent.
        raise HTTPException(
            status_code=404, detail={"error_code": exc.error_code, "message": exc.message}
        ) from exc

    service = request.app.state.publication_service
    try:
        outcome = service.publish(
            gold_ready,
            requested_format=body.format,
            republish=body.republish,
            external_idempotency_key=body.external_idempotency_key,
        )
    except PublicationError as exc:
        # Raised before any publication run row exists (spec §32: a safe,
        # structured error rather than an unhandled 500) -- currently only
        # ENTITLEMENT_DENIED and UNSUPPORTED_FORMAT reach this path; every
        # other failure mode is caught inside publish() and returned as a
        # FAILED PublicationOutcome instead.
        status_code = 403 if exc.error_code == "ENTITLEMENT_DENIED" else 400
        raise HTTPException(status_code=status_code, detail={"error_code": exc.error_code, "message": exc.message}) from exc
    return _outcome_out(outcome)
