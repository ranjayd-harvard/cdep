from __future__ import annotations

import hashlib
import io
from typing import BinaryIO

import boto3
from botocore.client import Config

from lakehouse.storage.interface import ObjectMetadata


class S3CompatibleStorage:
    """StorageClient implementation for S3-compatible object storage.

    Works unmodified against MinIO (local) or real AWS S3 (production) --
    only `endpoint_url`/credentials differ, per the storage abstraction
    requirement in AGENTS.md section 28/51.
    """

    def __init__(
        self,
        *,
        endpoint_url: str | None,
        access_key: str,
        secret_key: str,
        region: str = "us-east-1",
    ) -> None:
        self._client = boto3.client(
            "s3",
            endpoint_url=endpoint_url,
            aws_access_key_id=access_key,
            aws_secret_access_key=secret_key,
            region_name=region,
            config=Config(signature_version="s3v4", s3={"addressing_style": "path"}),
        )

    def exists(self, bucket: str, key: str) -> bool:
        try:
            self._client.head_object(Bucket=bucket, Key=key)
            return True
        except self._client.exceptions.ClientError:
            return False

    def open(self, bucket: str, key: str) -> BinaryIO:
        # Buffer fully into memory rather than handing back boto3's raw
        # StreamingBody: it is neither seekable (Parquet needs random
        # access) nor does repeated reads after EOF behave like a normal
        # file object (breaks io.TextIOWrapper used by the CSV/JSON
        # readers). Fine at exchange-file scale; revisit if/when very
        # large sources need true streaming.
        response = self._client.get_object(Bucket=bucket, Key=key)
        return io.BytesIO(response["Body"].read())

    def metadata(self, bucket: str, key: str) -> ObjectMetadata:
        head = self._client.head_object(Bucket=bucket, Key=key)
        return ObjectMetadata(
            bucket=bucket,
            key=key,
            size_bytes=head["ContentLength"],
            content_type=head.get("ContentType"),
            etag=head.get("ETag"),
        )

    def checksum(self, bucket: str, key: str, algorithm: str = "SHA-256") -> str:
        h = hashlib.new(algorithm.replace("-", "").lower())
        body = self.open(bucket, key)
        for chunk in iter(lambda: body.read(1024 * 1024), b""):
            h.update(chunk)
        return h.hexdigest()

    def list(self, bucket: str, prefix: str) -> list[str]:
        paginator = self._client.get_paginator("list_objects_v2")
        keys: list[str] = []
        for page in paginator.paginate(Bucket=bucket, Prefix=prefix):
            keys.extend(obj["Key"] for obj in page.get("Contents", []))
        return keys

    def put_bytes(
        self, bucket: str, key: str, data: bytes, content_type: str | None = None
    ) -> None:
        kwargs = {"Bucket": bucket, "Key": key, "Body": data}
        if content_type:
            kwargs["ContentType"] = content_type
        self._client.put_object(**kwargs)

    def delete(self, bucket: str, key: str) -> None:
        self._client.delete_object(Bucket=bucket, Key=key)

    def create_bucket(self, bucket: str) -> None:
        try:
            self._client.create_bucket(Bucket=bucket)
        except self._client.exceptions.ClientError:
            pass  # already exists
