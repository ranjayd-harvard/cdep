"""Re-export of Phase 2's BronzeReady handoff (`lakehouse.bronze.notifier`).

Kept in its original Phase 2 location rather than moved here, per AGENTS.md
"do not rewrite working Phase 2 components unnecessarily" -- this module
exists only so the Phase 3 `notifications/` package is a complete, discoverable
home for all three *Ready handoffs, matching the target repository layout.
"""

from __future__ import annotations

from lakehouse.bronze.notifier import (
    BronzeCompletionNotifier,
    BronzeReady,
    LoggingBronzeCompletionNotifier,
)

__all__ = ["BronzeReady", "BronzeCompletionNotifier", "LoggingBronzeCompletionNotifier"]
