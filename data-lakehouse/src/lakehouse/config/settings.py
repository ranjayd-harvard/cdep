"""Environment-driven settings. See .env.example for the full list.

Business/ingestion code should depend on `Settings`, never read
`os.environ` directly — that keeps cloud portability (section 51 of
AGENTS.md) enforced at the boundary.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

import yaml
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[3]
CONTRACTS_DIR = REPO_ROOT / "contracts"
CONFIG_DIR = REPO_ROOT / "config"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="LAKEHOUSE_", env_file=".env", extra="ignore")

    env: str = Field(default="local", alias="LAKEHOUSE_ENV")

    # Ingestion metadata store (Postgres)
    metadata_db_host: str = Field(default="localhost")
    metadata_db_port: int = Field(default=5434)
    metadata_db_name: str = Field(default="lakehouse")
    metadata_db_user: str = Field(default="lakehouse")
    metadata_db_password: str = Field(default="lakehouse")
    metadata_db_schema: str = Field(default="lakehouse")

    # Iceberg catalog
    catalog_name: str = Field(default="local")
    catalog_uri: str = Field(
        default="postgresql+psycopg2://lakehouse:lakehouse@localhost:5434/lakehouse"
    )
    catalog_schema: str = Field(default="iceberg_catalog")
    warehouse: str = Field(default="s3://lakehouse-bronze/")

    # Object storage
    storage_kind: str = Field(default="s3")  # s3 | local | gcs
    s3_endpoint: str = Field(default="http://localhost:9010")
    s3_access_key: str = Field(default="lakehouse")
    s3_secret_key: str = Field(default="lakehouse123")
    s3_region: str = Field(default="us-east-1")

    bucket_exchange_inbound: str = Field(default="exchange-inbound")
    bucket_bronze: str = Field(default="lakehouse-bronze")
    bucket_silver: str = Field(default="lakehouse-silver")
    bucket_gold: str = Field(default="lakehouse-gold")

    # Exchange Service integration
    exchange_client: str = Field(default="mock")  # mock | http
    exchange_service_base_url: str = Field(default="http://localhost:8080")
    # Sent as the `x-internal-api-key` header to data-exchange-service's
    # internal-only routes (requireInternalApiKey) -- must match its
    # INTERNAL_API_KEY. Only used when exchange_client == "http".
    exchange_service_api_key: str = Field(default="")

    # Object storage for the *source* exchange-inbound bucket, used only
    # when exchange_client == "http". This is deliberately separate from
    # s3_endpoint/s3_access_key/s3_secret_key above: those point at the
    # lakehouse's own MinIO/S3 (Bronze/Silver/Gold + rejects), while a real
    # exchange-service instance's uploaded files live in *its own* object
    # storage. In local dev these are two different MinIO containers
    # (different ports); in a real cloud deployment they would likely be
    # the same S3/GCS account and this split collapses to matching values.
    exchange_s3_endpoint: str = Field(default="http://localhost:9000")
    exchange_s3_access_key: str = Field(default="minioadmin")
    exchange_s3_secret_key: str = Field(default="minioadmin")
    exchange_s3_region: str = Field(default="us-east-1")

    # Schema evolution
    schema_mode: str = Field(default="PERMISSIVE")

    # Inbound auth for THIS service's own internal HTTP API (src/lakehouse/api/),
    # checked against the `x-internal-api-key` header on every request -- a
    # separate key/service from exchange_service_api_key above, which is
    # OUTBOUND auth this service sends TO data-exchange-service.
    internal_api_key: str = Field(default="")
    api_port: int = Field(default=8000)

    @property
    def metadata_db_url(self) -> str:
        return (
            f"postgresql+psycopg2://{self.metadata_db_user}:{self.metadata_db_password}"
            f"@{self.metadata_db_host}:{self.metadata_db_port}/{self.metadata_db_name}"
        )

    def bucket_for_namespace(self, namespace: str) -> str:
        """Each medallion layer gets its own bucket (AGENTS.md section 5) --
        bronze/silver/gold tables must never physically share one bucket."""
        mapping = {
            "bronze": self.bucket_bronze,
            "silver": self.bucket_silver,
            "gold": self.bucket_gold,
        }
        try:
            return mapping[namespace]
        except KeyError:
            raise ValueError(f"No bucket configured for namespace '{namespace}'") from None

    def location_for_table(self, namespace: str, table_name: str) -> str:
        """Explicit per-table location so a new table lands in its
        namespace's own bucket, rather than defaulting to the catalog's
        single `warehouse` root (which is fixed to the Bronze bucket)."""
        bucket = self.bucket_for_namespace(namespace)
        scheme = {"s3": "s3", "gcs": "gs", "local": "file"}[self.storage_kind]
        if scheme == "file":
            return f"{bucket}/{namespace}/{table_name}"
        return f"{scheme}://{bucket}/{namespace}/{table_name}"


@lru_cache
def get_settings() -> Settings:
    return Settings()


@lru_cache
def load_application_config() -> dict:
    with open(CONFIG_DIR / "application.yaml") as f:
        return yaml.safe_load(f)


def load_data_product_contract_dict(data_product_id: str) -> dict:
    path = CONTRACTS_DIR / "bronze" / f"{data_product_id}.yaml"
    if not path.exists():
        raise FileNotFoundError(f"No data contract configured for '{data_product_id}': {path}")
    with open(path) as f:
        return yaml.safe_load(f)
