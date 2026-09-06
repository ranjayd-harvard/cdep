"""Coarse snapshot/run-level lineage graph (AGENTS.md section 46).

Deliberately not a full enterprise lineage catalog -- just enough to answer
"what upstream Bronze/Silver run produced this Gold snapshot" via a small
number of recorded edges plus the record-level lineage columns already
carried on every Silver/Gold row (see `lakehouse.silver.lineage` /
`lakehouse.gold.lineage`).
"""

from __future__ import annotations

from lakehouse.lineage.lineage_service import LineageService
from lakehouse.lineage.models import LineageEdge

__all__ = ["LineageEdge", "LineageService"]
