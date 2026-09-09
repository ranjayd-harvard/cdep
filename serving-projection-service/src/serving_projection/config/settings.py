"""Environment-driven settings. See .env.example for the full list.

Business logic should depend on `Settings`, never read `os.environ`
directly -- same discipline data-publication-service's own
`publication.config.settings` follows.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[3]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="SERVING_", env_file=".env", extra="ignore")

    env: str = Field(default="local")

    # This service's own control-plane store -- also the "PostgreSQL API
    # Serving Store" itself (schema api_serving): unlike
    # data-publication-service, there is no separate control-plane-vs-output
    # split here, because the serving store's whole purpose IS to be read
    # directly by data-product-api-service.
    db_host: str = Field(default="localhost")
    db_port: int = Field(default=5440)
    db_name: str = Field(default="serving")
    db_user: str = Field(default="serving")
    db_password: str = Field(default="serving")

    # Lakehouse Iceberg catalog (read-only -- serving projection never
    # writes to Gold). Same catalog/warehouse data-publication-service reads.
    lakehouse_catalog_name: str = Field(default="local")
    lakehouse_catalog_uri: str = Field(
        default="postgresql+psycopg2://lakehouse:lakehouse@localhost:5434/lakehouse"
    )
    lakehouse_warehouse: str = Field(default="s3://lakehouse-bronze/")
    lakehouse_s3_endpoint: str = Field(default="http://localhost:9010")
    lakehouse_s3_access_key: str = Field(default="lakehouse")
    lakehouse_s3_secret_key: str = Field(default="lakehouse123")
    lakehouse_s3_region: str = Field(default="us-east-1")

    # Inbound auth for this service's own internal HTTP API (ops-only).
    internal_api_key: str = Field(default="")
    api_port: int = Field(default=8000)

    @property
    def db_url(self) -> str:
        return (
            f"postgresql+psycopg2://{self.db_user}:{self.db_password}"
            f"@{self.db_host}:{self.db_port}/{self.db_name}"
        )


@lru_cache
def get_settings() -> Settings:
    return Settings()
