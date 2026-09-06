from __future__ import annotations

from lakehouse.config.settings import Settings
from lakehouse.exchange.client import (
    ExchangeServiceClient,
    HttpExchangeServiceClient,
    MockExchangeServiceClient,
)
from lakehouse.storage.interface import StorageClient

__all__ = ["ExchangeServiceClient", "build_exchange_client"]


def build_exchange_client(settings: Settings, storage: StorageClient) -> ExchangeServiceClient:
    if settings.exchange_client == "mock":
        return MockExchangeServiceClient(storage, settings.bucket_exchange_inbound)
    if settings.exchange_client == "http":
        return HttpExchangeServiceClient(
            settings.exchange_service_base_url, settings.exchange_service_api_key
        )
    raise ValueError(f"Unknown exchange_client: {settings.exchange_client}")
