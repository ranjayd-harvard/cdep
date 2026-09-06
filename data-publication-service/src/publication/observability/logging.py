"""Structured logging setup (AGENTS.md section 53).

Every log line that touches a publication run should carry publication_id,
organization_id, tenant_id, data_product_id, product_version, and status
where available -- callers bind these via structlog.contextvars, not by
passing them to every individual log call.

Never log: full customer records, secrets, signed URLs, or access tokens.
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
