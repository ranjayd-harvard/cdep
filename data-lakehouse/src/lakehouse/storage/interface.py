"""Storage abstraction (AGENTS.md section 28).

Ingestion business logic (readers, bronze writer, lineage) must depend only
on this interface — never on boto3/S3/GCS APIs directly. Cloud-specific
behavior is isolated to the adapter implementations in this package.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import BinaryIO, Protocol


@dataclass(frozen=True)
class ObjectMetadata:
    bucket: str
    key: str
    size_bytes: int
    content_type: str | None = None
    etag: str | None = None


class StorageClient(Protocol):
    """A minimal, cloud-agnostic object storage interface."""

    def exists(self, bucket: str, key: str) -> bool: ...

    def open(self, bucket: str, key: str) -> BinaryIO:
        """Return a readable binary file-like object for the object."""
        ...

    def metadata(self, bucket: str, key: str) -> ObjectMetadata: ...

    def checksum(self, bucket: str, key: str, algorithm: str = "SHA-256") -> str:
        """Compute a checksum by streaming the object. Used to verify the
        manifest's declared checksum when feasible."""
        ...

    def list(self, bucket: str, prefix: str) -> list[str]: ...

    def put_bytes(self, bucket: str, key: str, data: bytes, content_type: str | None = None) -> None: ...

    def delete(self, bucket: str, key: str) -> None: ...
