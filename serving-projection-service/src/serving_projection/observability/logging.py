"""Structured logging setup. Mirrors data-publication-service's
`publication.observability.logging` exactly.

Every log line touching a projection run should carry projection_run_id,
product_id, product_version, refresh_type, and status where available --
callers bind these via structlog.contextvars.

Never log: full customer records, secrets, or connection strings.
"""

from __future__ import annotations

import logging

import structlog


def configure_logging(level: int = logging.INFO) -> None:
    logging.basicConfig(format="%(message)s", level=level)
    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso"),
            structlog.processors.StackInfoRenderer(),
            structlog.processors.format_exc_info,
            structlog.processors.JSONRenderer(),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(level),
        context_class=dict,
        logger_factory=structlog.PrintLoggerFactory(),
        cache_logger_on_first_use=True,
    )
