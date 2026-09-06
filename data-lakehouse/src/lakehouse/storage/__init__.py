from __future__ import annotations

from lakehouse.config.settings import REPO_ROOT, Settings
from lakehouse.storage.interface import ObjectMetadata, StorageClient
from lakehouse.storage.local_storage import LocalStorage
from lakehouse.storage.s3_storage import S3CompatibleStorage

__all__ = [
    "ObjectMetadata",
    "StorageClient",
    "LocalStorage",
    "S3CompatibleStorage",
    "build_storage_client",
    "build_exchange_storage_client",
]


def build_storage_client(settings: Settings) -> StorageClient:
    """Factory selecting the lakehouse's *own* storage backend (Bronze/
    Silver/Gold + rejects). This is the single place ingestion code needs
    to touch to change cloud providers."""
    if settings.storage_kind == "local":
        return LocalStorage(REPO_ROOT / "storage")
    if settings.storage_kind == "s3":
        return S3CompatibleStorage(
            endpoint_url=settings.s3_endpoint,
            access_key=settings.s3_access_key,
            secret_key=settings.s3_secret_key,
            region=settings.s3_region,
        )
    if settings.storage_kind == "gcs":
        from lakehouse.storage.gcs_storage import GCSStorage

        return GCSStorage(project_id=settings.env)
    raise ValueError(f"Unknown storage_kind: {settings.storage_kind}")


def build_exchange_storage_client(settings: Settings) -> StorageClient:
    """Factory for the *source* exchange-inbound object store -- only
    meaningfully different from `build_storage_client` when
    exchange_client == "http" (a real data-exchange-service instance with
    its own MinIO/S3). In mock mode the caller should just reuse the
    lakehouse's own storage client instead of calling this."""
    return S3CompatibleStorage(
        endpoint_url=settings.exchange_s3_endpoint,
        access_key=settings.exchange_s3_access_key,
        secret_key=settings.exchange_s3_secret_key,
        region=settings.exchange_s3_region,
    )
