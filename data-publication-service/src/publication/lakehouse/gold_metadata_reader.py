"""Resolves a GoldReady context from data-lakehouse's own pipeline metadata
(`lakehouse.pipeline_runs`) given a bare `--pipeline-run-id` (AGENTS.md
section 37, CLI form A).

This is a read-only cross-service read of another service's database --
acceptable here because pipeline_runs *is* the durable, already-persisted
record of the exact GoldReady event that was emitted (see data-lakehouse's
`pipelines.pipeline_runner.run_silver_to_gold`, which calls
`notifier.notify(gold_ready_event)` with exactly these fields right after
`pipeline_repo.mark_completed(...)`). It avoids requiring an HTTP API on
the lakehouse side or a message bus (AGENTS.md section 36: "do not require
an event bus").
"""

from __future__ import annotations

from functools import lru_cache

import sqlalchemy as sa
from sqlalchemy import Engine

from publication.common.errors import GoldReadyNotFoundError
from publication.config.settings import get_settings
from publication.models.gold_ready import GoldReadyContext


@lru_cache
def get_lakehouse_metadata_engine() -> Engine:
    return sa.create_engine(get_settings().lakehouse_metadata_db_url, pool_pre_ping=True)


def resolve_gold_ready_by_pipeline_run_id(pipeline_run_id: str, engine: Engine | None = None) -> GoldReadyContext:
    engine = engine or get_lakehouse_metadata_engine()
    with engine.connect() as conn:
        row = conn.execute(
            sa.text(
                """
                SELECT pipeline_run_id, organization_id, tenant_id, data_product_id,
                       contract_version, target_table, target_snapshot_id,
                       output_record_count, status, pipeline_type
                FROM lakehouse.pipeline_runs
                WHERE pipeline_run_id = :id
                """
            ),
            {"id": pipeline_run_id},
        ).mappings().first()

    if row is None:
        raise GoldReadyNotFoundError(f"No lakehouse pipeline run found for pipeline_run_id='{pipeline_run_id}'")
    if row["pipeline_type"] != "SILVER_TO_GOLD":
        raise GoldReadyNotFoundError(
            f"pipeline_run_id='{pipeline_run_id}' is a {row['pipeline_type']} run, not SILVER_TO_GOLD -- "
            f"publication only starts from a Gold pipeline run."
        )
    if row["status"] != "COMPLETED":
        raise GoldReadyNotFoundError(
            f"pipeline_run_id='{pipeline_run_id}' has status={row['status']!r}, not COMPLETED -- "
            f"GoldReady was never (successfully) emitted for this run."
        )

    return GoldReadyContext(
        pipelineRunId=row["pipeline_run_id"],
        organizationId=row["organization_id"],
        tenantId=row["tenant_id"],
        dataProductId=row["data_product_id"],
        productVersion=row["contract_version"],
        goldTable=row["target_table"],
        goldSnapshotId=row["target_snapshot_id"],
        recordCount=row["output_record_count"] or 0,
    )
