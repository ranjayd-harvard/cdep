"""Minimal metrics surface (AGENTS.md section 53). No metrics backend is
wired up for local dev -- these are logged as structured events so they
show up in the same place as everything else; a real deployment would
swap `record` for a StatsD/CloudWatch/Prometheus client without touching
call sites.
"""

from __future__ import annotations

import structlog

log = structlog.get_logger("publication.metrics")


def record(metric_name: str, value: float, **tags: object) -> None:
    log.info("metric", metric=metric_name, value=value, **tags)
