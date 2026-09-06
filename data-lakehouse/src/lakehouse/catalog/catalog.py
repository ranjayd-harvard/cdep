"""Iceberg catalog configuration (AGENTS.md sections 8/31).

Local development uses PyIceberg's SQL catalog (metadata in Postgres,
warehouse data files in MinIO). Swapping to a production catalog (e.g. AWS
Glue) later is a configuration change here only -- ingestion/bronze code
never talks to the catalog directly, only through `get_catalog()` and the
helpers in `iceberg.py`.
"""

from __future__ import annotations

from functools import lru_cache

from pyiceberg.catalog import Catalog
from pyiceberg.catalog.sql import SqlCatalog

from lakehouse.config.settings import Settings, get_settings


def build_catalog(settings: Settings) -> Catalog:
    properties = {
        "uri": settings.catalog_uri,
        "warehouse": settings.warehouse,
    }
    if settings.storage_kind == "s3":
        properties.update(
            {
                "s3.endpoint": settings.s3_endpoint,
                "s3.access-key-id": settings.s3_access_key,
                "s3.secret-access-key": settings.s3_secret_key,
                "s3.region": settings.s3_region,
                # MinIO needs path-style addressing (bucket.endpoint.com does
                # not resolve locally); real AWS S3 works fine with either.
                "s3.force-virtual-addressing": "false",
            }
        )
    return SqlCatalog(settings.catalog_name, **properties)


@lru_cache
def get_catalog() -> Catalog:
    return build_catalog(get_settings())
