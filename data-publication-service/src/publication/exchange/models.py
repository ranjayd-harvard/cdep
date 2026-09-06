from __future__ import annotations

from dataclasses import dataclass


@dataclass
class UploadTarget:
    method: str
    url: str
    expires_in_seconds: int
    content_type: str


@dataclass
class CreatedOutboundPublication:
    exchange_id: str
    status: str
    upload: UploadTarget


@dataclass
class CompletedOutboundPublication:
    exchange_id: str
    status: str


@dataclass
class ExchangeManifestInfo:
    exchange_id: str
    status: str
    direction: str
    raw: dict
