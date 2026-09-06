from __future__ import annotations

import hashlib
import shutil
from pathlib import Path
from typing import BinaryIO

from lakehouse.storage.interface import ObjectMetadata


class LocalStorage:
    """Filesystem-backed StorageClient. `bucket` maps to a top-level
    directory under `root`; `key` is a relative path within it."""

    def __init__(self, root: str | Path) -> None:
        self.root = Path(root)

    def _path(self, bucket: str, key: str) -> Path:
        return self.root / bucket / key

    def exists(self, bucket: str, key: str) -> bool:
        return self._path(bucket, key).is_file()

    def open(self, bucket: str, key: str) -> BinaryIO:
        return open(self._path(bucket, key), "rb")

    def metadata(self, bucket: str, key: str) -> ObjectMetadata:
        p = self._path(bucket, key)
        stat = p.stat()
        return ObjectMetadata(bucket=bucket, key=key, size_bytes=stat.st_size)

    def checksum(self, bucket: str, key: str, algorithm: str = "SHA-256") -> str:
        h = hashlib.new(algorithm.replace("-", "").lower())
        with self.open(bucket, key) as f:
            for chunk in iter(lambda: f.read(1024 * 1024), b""):
                h.update(chunk)
        return h.hexdigest()

    def list(self, bucket: str, prefix: str) -> list[str]:
        base = self.root / bucket
        prefix_path = base / prefix
        parent = prefix_path.parent if not prefix_path.is_dir() else prefix_path
        if not parent.exists():
            return []
        return [
            str(p.relative_to(base))
            for p in parent.rglob("*")
            if p.is_file() and str(p.relative_to(base)).startswith(prefix)
        ]

    def put_bytes(
        self, bucket: str, key: str, data: bytes, content_type: str | None = None
    ) -> None:
        path = self._path(bucket, key)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)

    def delete(self, bucket: str, key: str) -> None:
        path = self._path(bucket, key)
        if path.exists():
            path.unlink()

    def create_bucket(self, bucket: str) -> None:
        (self.root / bucket).mkdir(parents=True, exist_ok=True)

    def _rmtree_bucket(self, bucket: str) -> None:
        shutil.rmtree(self.root / bucket, ignore_errors=True)
