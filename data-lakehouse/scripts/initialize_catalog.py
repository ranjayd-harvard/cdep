#!/usr/bin/env python
"""Idempotently create the Iceberg namespaces (bronze/silver/gold) and, for
local storage backends, the object storage buckets. For MinIO, buckets are
normally created by the `bucket-init` compose service instead -- this
script's bucket creation is a convenience fallback when running outside
Docker.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

import structlog

from lakehouse.catalog.catalog import get_catalog
from lakehouse.catalog.iceberg import ensure_namespace
from lakehouse.config.settings import get_settings
from lakehouse.observability.logging import configure_logging
from lakehouse.storage import build_storage_client

log = structlog.get_logger(__name__)


def main() -> int:
    configure_logging()
    settings = get_settings()
    catalog = get_catalog()

    for namespace in ("bronze", "silver", "gold"):
        ensure_namespace(catalog, namespace)
        log.info("catalog.namespace.ready", namespace=namespace)

    storage = build_storage_client(settings)
    if hasattr(storage, "create_bucket"):
        for bucket in (
            settings.bucket_exchange_inbound,
            settings.bucket_bronze,
            settings.bucket_silver,
            settings.bucket_gold,
        ):
            storage.create_bucket(bucket)
            log.info("storage.bucket.ready", bucket=bucket)

    log.info("catalog.initialize.completed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
