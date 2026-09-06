"""Integration test fixtures.

These tests exercise the real local stack (Postgres + MinIO) started via
`docker compose up -d postgres minio bucket-init`. They are skipped
automatically if that stack is not reachable, so `pytest` still runs clean
in an environment without Docker -- but the full suite (including these)
is what should be run before declaring Phase 2 done.

Each test gets its own throwaway data product / Bronze table (a temp
contract YAML dropped into contracts/bronze/ and removed on teardown) so
tests never collide with each other or with manually-staged demo data in
bronze.event_data.
"""

from __future__ import annotations

import hashlib
import json
import socket
import uuid
from datetime import UTC, datetime

import pytest
import yaml

from lakehouse.bronze.notifier import LoggingBronzeCompletionNotifier
from lakehouse.catalog.catalog import get_catalog
from lakehouse.config.settings import CONTRACTS_DIR, get_settings
from lakehouse.exchange import build_exchange_client
from lakehouse.ingestion.ingestion_repository import IngestionRepository, get_engine
from lakehouse.ingestion.ingestion_service import IngestionService
from lakehouse.observability.logging import configure_logging
from lakehouse.storage import build_storage_client


def _port_open(host: str, port: int) -> bool:
    try:
        with socket.create_connection((host, port), timeout=1.5):
            return True
    except OSError:
        return False


def _stack_available() -> bool:
    settings = get_settings()
    return _port_open(settings.metadata_db_host, settings.metadata_db_port) and _port_open(
        "localhost", 9010
    )


requires_local_stack = pytest.mark.skipif(
    not _stack_available(),
    reason="Postgres/MinIO not reachable -- run `docker compose up -d postgres minio bucket-init`",
)


@pytest.fixture(scope="session", autouse=True)
def _logging():
    configure_logging()


@pytest.fixture
def settings():
    return get_settings()


@pytest.fixture
def storage(settings):
    return build_storage_client(settings)


@pytest.fixture
def catalog():
    return get_catalog()


@pytest.fixture
def repo():
    return IngestionRepository(get_engine())


@pytest.fixture
def exchange_client(settings, storage):
    return build_exchange_client(settings, storage)


@pytest.fixture
def unique_id():
    return uuid.uuid4().hex[:10]


@pytest.fixture
def data_product(unique_id, catalog):
    """A throwaway data product + Bronze table, isolated per test."""
    data_product_id = f"it-event-{unique_id}"
    table_name = f"event_data_{unique_id}"
    contract = {
        "dataProductId": data_product_id,
        "version": "1.0",
        "owner": "integration-tests",
        "source": {"formats": ["CSV", "JSON", "PARQUET"]},
        "bronze": {"namespace": "bronze", "table": table_name},
        "csv": {"header": True, "delimiter": ",", "encoding": "UTF-8"},
        "json": {"lines": True, "encoding": "UTF-8"},
        "schema": {
            "mode": "PERMISSIVE",
            "fields": [
                {"name": "event_id", "type": "string", "required": True},
                {"name": "venue_id", "type": "string", "required": True},
                {"name": "event_date", "type": "string", "required": True},
                {"name": "tickets_sold", "type": "long", "required": False},
                {"name": "gross_revenue", "type": "double", "required": False},
            ],
        },
        "quality": {"rejectUnreadableRecords": True},
    }
    path = CONTRACTS_DIR / "bronze" / f"{data_product_id}.yaml"
    path.write_text(yaml.safe_dump(contract))

    yield data_product_id, table_name

    path.unlink(missing_ok=True)
    try:
        catalog.drop_table(f"bronze.{table_name}")
    except Exception:  # noqa: BLE001 - best-effort cleanup
        pass


@pytest.fixture
def stage_exchange(settings, storage):
    """Stage a fixture exchange (manifest.json + data file) into the
    exchange-inbound bucket, mirroring scripts/create_sample_exchange.py."""

    def _stage(
        *,
        exchange_id: str,
        organization_id: str,
        tenant_id: str,
        data_product_id: str,
        schema_version: str = "1.0",
        file_bytes: bytes,
        filename: str,
        fmt: str,
        status: str = "VALIDATED",
    ) -> None:
        checksum = hashlib.sha256(file_bytes).hexdigest()
        prefix = f"exchanges/{exchange_id}"
        storage.put_bytes(settings.bucket_exchange_inbound, f"{prefix}/{filename}", file_bytes)
        manifest = {
            "manifestVersion": "1.0",
            "exchange": {"exchangeId": exchange_id, "direction": "INBOUND", "status": status},
            "ownership": {"organizationId": organization_id, "tenantId": tenant_id},
            "submittedBy": {"userId": "usr-test"},
            "dataProduct": {"dataProductId": data_product_id, "schemaVersion": schema_version},
            "file": {
                "originalFilename": filename,
                "contentType": "application/octet-stream",
                "format": fmt,
                "sizeBytes": len(file_bytes),
                "checksumAlgorithm": "SHA-256",
                "checksum": checksum,
            },
            "source": {"channel": "CUSTOMER_PORTAL"},
            "timestamps": {"receivedAt": datetime.now(UTC).isoformat()},
        }
        storage.put_bytes(
            settings.bucket_exchange_inbound,
            f"{prefix}/manifest.json",
            json.dumps(manifest).encode("utf-8"),
            "application/json",
        )

    return _stage


@pytest.fixture
def service(settings, storage, catalog, exchange_client, repo):
    return IngestionService(
        settings=settings,
        storage=storage,
        catalog=catalog,
        exchange_client=exchange_client,
        repo=repo,
        notifier=LoggingBronzeCompletionNotifier(),
    )


# ---------------------------------------------------------------------------
# Phase 3: Bronze -> Silver -> Gold pipeline fixtures.
# ---------------------------------------------------------------------------


@pytest.fixture
def pipeline_repo(engine):
    from lakehouse.pipelines.pipeline_repository import PipelineRepository

    return PipelineRepository(engine)


@pytest.fixture
def engine():
    return get_engine()


@pytest.fixture
def phase3_registration(data_product, unique_id, catalog):
    """Dynamically registers a throwaway Bronze->Silver->Gold pipeline
    (isolated Silver/Gold Iceberg tables, reusing the real `event` /
    `event-performance` contracts since those describe schema/rules, not
    physical table identity) so integration tests never collide with each
    other or with manually-run demo data in silver.event/gold.event_performance.
    """
    from lakehouse.gold.products.event_performance import (
        GOLD_EVENT_PERFORMANCE_GRAIN_KEY,
        GOLD_EVENT_PERFORMANCE_SCHEMA,
        build_event_performance,
    )
    from lakehouse.pipelines import registry as reg
    from lakehouse.silver.models.event import SILVER_EVENT_SCHEMA

    data_product_id, _bronze_table_name = data_product

    silver_entity_key = f"event_{unique_id}"
    silver_table_name = f"event_{unique_id}"
    gold_product_key = f"event-performance-{unique_id}"
    gold_table_name = f"event_performance_{unique_id}"

    reg.SILVER_ENTITIES[silver_entity_key] = reg.SilverEntityRegistration(
        entity=silver_entity_key,
        table_name=silver_table_name,
        contract_id="event",
        schema=SILVER_EVENT_SCHEMA,
        date_column="event_date",
    )
    reg.BRONZE_TO_SILVER_PIPELINES[data_product_id] = reg.BronzeToSilverRegistration(
        data_product_id=data_product_id,
        pipeline_name=f"test-bronze-to-silver-{unique_id}",
        pipeline_version="1.0",
        mapping_id="event-data-to-event",
        silver_entity=silver_entity_key,
        gold_products=[gold_product_key],
    )
    reg.SILVER_TO_GOLD_PIPELINES[gold_product_key] = reg.SilverToGoldRegistration(
        data_product_id="event-performance",  # reuse the real contract file
        pipeline_name=f"test-silver-to-gold-{unique_id}",
        pipeline_version="1.0",
        source_silver_entity=silver_entity_key,
        gold_table_name=gold_table_name,
        schema=GOLD_EVENT_PERFORMANCE_SCHEMA,
        date_column="event_date",
        grain_key=GOLD_EVENT_PERFORMANCE_GRAIN_KEY,
        builder=build_event_performance,
    )

    yield {
        "data_product_id": data_product_id,
        "gold_product_id": gold_product_key,
        "silver_table": f"silver.{silver_table_name}",
        "gold_table": f"gold.{gold_table_name}",
    }

    del reg.SILVER_ENTITIES[silver_entity_key]
    del reg.BRONZE_TO_SILVER_PIPELINES[data_product_id]
    del reg.SILVER_TO_GOLD_PIPELINES[gold_product_key]
    for identifier in (f"silver.{silver_table_name}", f"gold.{gold_table_name}"):
        try:
            catalog.drop_table(identifier)
        except Exception:  # noqa: BLE001 - best-effort cleanup
            pass
