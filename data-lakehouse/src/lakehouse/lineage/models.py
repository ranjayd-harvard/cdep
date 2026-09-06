from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime


@dataclass
class LineageEdge:
    lineage_edge_id: int
    source_type: str
    source_identifier: str
    target_type: str
    target_identifier: str
    pipeline_run_id: str | None
    organization_id: str
    tenant_id: str
    created_at: datetime
