"""GCSStorage: interface/configuration placeholder for the future GCP
deployment target (AGENTS.md sections 12/33).

Not exercised locally -- `google-cloud-storage` is intentionally not a
project dependency yet, so this adapter imports it lazily. Implementing this
class fully (when a GCP environment becomes available) requires no changes
to ingestion business logic: it only needs to satisfy the same
StorageClient protocol as LocalStorage/S3CompatibleStorage.
"""

from __future__ import annotations

from typing import BinaryIO

from lakehouse.storage.interface import ObjectMetadata


class GCSStorage:
    def __init__(self, *, project_id: str, credentials_path: str | None = None) -> None:
        try:
            from google.cloud import storage as gcs
        except ImportError as exc:  # pragma: no cover
            raise NotImplementedError(
                "google-cloud-storage is not installed. Add it as a dependency "
                "when a GCP deployment target is provisioned."
            ) from exc
        self._client = gcs.Client(project=project_id)

    def exists(self, bucket: str, key: str) -> bool:
        raise NotImplementedError

    def open(self, bucket: str, key: str) -> BinaryIO:
        raise NotImplementedError

    def metadata(self, bucket: str, key: str) -> ObjectMetadata:
        raise NotImplementedError

    def checksum(self, bucket: str, key: str, algorithm: str = "SHA-256") -> str:
        raise NotImplementedError

    def list(self, bucket: str, prefix: str) -> list[str]:
        raise NotImplementedError

    def put_bytes(
        self, bucket: str, key: str, data: bytes, content_type: str | None = None
    ) -> None:
        raise NotImplementedError

    def delete(self, bucket: str, key: str) -> None:
        raise NotImplementedError
