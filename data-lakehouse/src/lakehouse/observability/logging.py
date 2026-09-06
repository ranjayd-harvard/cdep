"""Structured logging configuration (AGENTS.md section 34).

Every ingestion log line should carry ingestion_id/exchange_id/
organization_id/tenant_id/data_product_id/status when available. Never log
secrets, credentials, signed URLs, or full file/customer content.
"""

from __future__ import annotations

import logging
import sys

import structlog

_SENSITIVE_KEYS = {"password", "secret", "credential", "signed_url", "authorization", "api_key"}


def _redact_sensitive(_logger: object, _method_name: str, event_dict: dict) -> dict:
    for key in list(event_dict.keys()):
        if any(marker in key.lower() for marker in _SENSITIVE_KEYS):
            event_dict[key] = "***REDACTED***"
    return event_dict


def configure_logging(level: int = logging.INFO) -> None:
    logging.basicConfig(format="%(message)s", stream=sys.stdout, level=level)
    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso"),
            _redact_sensitive,
            structlog.processors.JSONRenderer(),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(level),
        logger_factory=structlog.PrintLoggerFactory(),
        cache_logger_on_first_use=True,
    )


def bind_ingestion_context(**kwargs: object) -> None:
    structlog.contextvars.bind_contextvars(**kwargs)


def clear_ingestion_context() -> None:
    structlog.contextvars.clear_contextvars()
