from __future__ import annotations

import sqlalchemy as sa
import structlog
from sqlalchemy import Engine

from lakehouse.common.time import utcnow
from lakehouse.lineage.models import LineageEdge

log = structlog.get_logger(__name__)


class LineageService:
    def __init__(self, engine: Engine) -> None:
        self._engine = engine

    def record_edge(
        self,
        *,
        source_type: str,
        source_identifier: str,
        target_type: str,
        target_identifier: str,
        pipeline_run_id: str | None,
        organization_id: str,
        tenant_id: str,
    ) -> None:
        with self._engine.begin() as conn:
            conn.execute(
                sa.text(
                    """
                    INSERT INTO lakehouse.lineage_edges (
                        source_type, source_identifier, target_type, target_identifier,
                        pipeline_run_id, organization_id, tenant_id, created_at
                    ) VALUES (
                        :source_type, :source_identifier, :target_type, :target_identifier,
                        :pipeline_run_id, :organization_id, :tenant_id, :now
                    )
                    """
                ),
                {
                    "source_type": source_type,
                    "source_identifier": source_identifier,
                    "target_type": target_type,
                    "target_identifier": target_identifier,
                    "pipeline_run_id": pipeline_run_id,
                    "organization_id": organization_id,
                    "tenant_id": tenant_id,
                    "now": utcnow(),
                },
            )
        log.info(
            "lineage.edge.recorded",
            source_type=source_type,
            source_identifier=source_identifier,
            target_type=target_type,
            target_identifier=target_identifier,
            pipeline_run_id=pipeline_run_id,
        )

    def upstream_of(self, *, target_type: str, target_identifier: str) -> list[LineageEdge]:
        """Direct upstream edges of one target node -- callers walk the
        chain by re-querying with each edge's `source_type`/
        `source_identifier` (AGENTS.md section 57's lineage trace)."""
        with self._engine.connect() as conn:
            rows = (
                conn.execute(
                    sa.text(
                        """
                        SELECT * FROM lakehouse.lineage_edges
                        WHERE target_type = :target_type AND target_identifier = :target_identifier
                        ORDER BY created_at DESC
                        """
                    ),
                    {"target_type": target_type, "target_identifier": target_identifier},
                )
                .mappings()
                .all()
            )
        return [LineageEdge(**dict(r)) for r in rows]
