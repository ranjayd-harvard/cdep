"""Generic Gold Data Product builder contract (AGENTS.md section 24).

Each concrete product (e.g. `lakehouse.gold.products.event_performance`)
implements `build()` -- pure business logic over Silver rows, no I/O, no
lineage stamping (that happens uniformly afterward via
`lakehouse.gold.lineage.attach_gold_lineage`).
"""

from __future__ import annotations

from typing import Any, Protocol


class GoldProductBuilder(Protocol):
    def build(self, silver_rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Pure transformation: Silver rows -> Gold business records (no
        lineage columns attached yet)."""
        ...
