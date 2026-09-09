"""Environment-driven settings. See .env.example for the full list.

Business logic should depend on `Settings`, never read `os.environ`
directly -- same discipline data-lakehouse's `lakehouse.config.settings`
follows, for the same reason (AWS/GCP portability is a config change here
only, see README "Deployment mapping").
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[3]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="PUBLICATION_", env_file=".env", extra="ignore")

    env: str = Field(default="local")

    # This service's own control-plane store.
    db_host: str = Field(default="localhost")
    db_port: int = Field(default=5436)
    db_name: str = Field(default="publication")
    db_user: str = Field(default="publication")
    db_password: str = Field(default="publication")

    # Lakehouse Iceberg catalog (read-only from this service's point of view
    # -- publication never writes to Gold).
    lakehouse_catalog_name: str = Field(default="local")
    lakehouse_catalog_uri: str = Field(
        default="postgresql+psycopg2://lakehouse:lakehouse@localhost:5434/lakehouse"
    )
    lakehouse_warehouse: str = Field(default="s3://lakehouse-bronze/")
    lakehouse_s3_endpoint: str = Field(default="http://localhost:9010")
    lakehouse_s3_access_key: str = Field(default="lakehouse")
    lakehouse_s3_secret_key: str = Field(default="lakehouse123")
    lakehouse_s3_region: str = Field(default="us-east-1")

    # Read-only access to data-lakehouse's own pipeline_runs table, to
    # resolve GoldReady context from a bare --pipeline-run-id.
    lakehouse_metadata_db_url: str = Field(
        default="postgresql+psycopg2://lakehouse:lakehouse@localhost:5434/lakehouse"
    )

    # Exchange Service integration.
    exchange_service_base_url: str = Field(default="http://localhost:8080")
    exchange_service_api_key: str = Field(default="")
    # Only needed when THIS service also runs inside Docker (its own
    # docker-compose `api` service): the signed PUT URL data-exchange-service
    # hands back names a host only reachable from a real browser or a
    # host-process ("localhost:9000" -- its OBJECT_STORAGE_PUBLIC_ENDPOINT),
    # not from inside this container. Same Docker-in-Docker problem
    # documented in ../docs/exchange-service-integration.md § "Docker-in-
    # Docker: the storage relay host problem" for cdep's own upload path --
    # identical fix here: connect to this reachable host instead, while
    # sending an explicit `Host` header matching what the URL's SigV4
    # signature was actually computed against.
    exchange_storage_relay_host: str = Field(default="")

    # Local working storage (never customer-accessible -- AGENTS.md section 20).
    work_dir: str = Field(default="./publication-work")

    # Contracts directory.
    contracts_dir: str = Field(default="./contracts/products")

    # Data Product Catalog (Phase 5) integration. "local" (default) keeps
    # today's behavior exactly as-is: publishedSchema/sla/quality/publication
    # settings come from contracts_dir_path YAML only, so nothing breaks for
    # anyone who hasn't stood up the catalog service. "catalog" overlays
    # those same fields from the Catalog's ACTIVE-version contract, while
    # `source.table` and `tenantScope` -- physical Gold wiring the Catalog
    # deliberately doesn't own, see data-product-catalog-service/README.md
    # "Publication Service / Portal integration" -- keep coming from the
    # local YAML either way. See contracts/catalog_client.py.
    contract_source: str = Field(default="local")
    catalog_service_base_url: str = Field(default="http://localhost:8092")
    catalog_service_api_key: str = Field(default="")

    # Inbound auth for THIS service's own internal HTTP API (src/publication/api/),
    # checked against the `x-internal-api-key` header -- a separate key from
    # exchange_service_api_key above, which is OUTBOUND auth this service
    # sends TO data-exchange-service. Backs the superadmin-only "Publish
    # Gold Product" panel at /admin/lakehouse/pipelines in the portal.
    internal_api_key: str = Field(default="")
    api_port: int = Field(default=8000)

    @property
    def db_url(self) -> str:
        return (
            f"postgresql+psycopg2://{self.db_user}:{self.db_password}"
            f"@{self.db_host}:{self.db_port}/{self.db_name}"
        )

    @property
    def work_dir_path(self) -> Path:
        path = Path(self.work_dir)
        path.mkdir(parents=True, exist_ok=True)
        return path

    @property
    def contracts_dir_path(self) -> Path:
        p = Path(self.contracts_dir)
        if not p.is_absolute():
            p = REPO_ROOT / p
        return p


@lru_cache
def get_settings() -> Settings:
    return Settings()
