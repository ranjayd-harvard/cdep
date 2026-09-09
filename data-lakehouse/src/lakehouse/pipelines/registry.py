"""Pipeline registry (AGENTS.md section 39).

A new entity/Data Product should require *config* here plus a contract +
mapping YAML -- not a copy-pasted pipeline. Deliberately a plain dict, not a
workflow engine: `pipeline_runner.py` reads it to know which contract,
mapping, Arrow schema, and business logic to wire together for a given
`data_product_id` / Gold `data_product_id`.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass

import pyarrow as pa

from lakehouse.gold.products.event_performance import (
    GOLD_EVENT_PERFORMANCE_GRAIN_KEY,
    GOLD_EVENT_PERFORMANCE_SCHEMA,
    build_event_performance,
)
from lakehouse.gold.products.test_metric_summary import (
    GOLD_TEST_METRIC_SUMMARY_GRAIN_KEY,
    GOLD_TEST_METRIC_SUMMARY_SCHEMA,
    build_test_metric_summary,
)
from lakehouse.gold.products.ranjay_test_metric_summary import (
    GOLD_RANJAY_TEST_METRIC_SUMMARY_GRAIN_KEY,
    GOLD_RANJAY_TEST_METRIC_SUMMARY_SCHEMA,
    build_ranjay_test_metric_summary,   
)   
from lakehouse.silver.models.event import SILVER_EVENT_SCHEMA
from lakehouse.silver.models.test_metric import SILVER_TEST_METRIC_SCHEMA
from lakehouse.silver.models.ranjay_test_metric import SILVER_RANJAY_TEST_METRIC_SCHEMA


@dataclass(frozen=True)
class SilverEntityRegistration:
    entity: str
    table_name: str  # silver.<table_name>
    contract_id: str  # contracts/silver/<contract_id>.yaml
    schema: pa.Schema
    date_column: str


@dataclass(frozen=True)
class BronzeToSilverRegistration:
    data_product_id: str  # Bronze data product (contracts/bronze/<id>.yaml)
    pipeline_name: str
    pipeline_version: str
    mapping_id: str  # mappings/bronze_to_silver/<mapping_id>.yaml
    silver_entity: str
    gold_products: list[str]


@dataclass(frozen=True)
class SilverToGoldRegistration:
    data_product_id: str  # Gold Data Product (contracts/gold/<id>.yaml)
    pipeline_name: str
    pipeline_version: str
    source_silver_entity: str
    gold_table_name: str  # gold.<gold_table_name>
    schema: pa.Schema
    date_column: str
    grain_key: list[str]
    builder: Callable[[list[dict]], list[dict]]


SILVER_ENTITIES: dict[str, SilverEntityRegistration] = {
    "event": SilverEntityRegistration(
        entity="event",
        table_name="event",
        contract_id="event",
        schema=SILVER_EVENT_SCHEMA,
        date_column="event_date",
    ),
    # Synthetic test entity -- see data-exchange-service/TEST-DataProduct-onboarding.MD.
    "test_metric": SilverEntityRegistration(
        entity="test_metric",
        table_name="test_metric",
        contract_id="test_metric",
        schema=SILVER_TEST_METRIC_SCHEMA,
        date_column="recorded_on",
    ),
    # Synthetic ranjay test entity -- see data-exchange-service/TEST-DataProduct-onboarding.MD.
    "ranjay_test_metric": SilverEntityRegistration(
        entity="ranjay_test_metric",
        table_name="ranjay_test_metric",
        contract_id="ranjay_test_metric",
        schema=SILVER_RANJAY_TEST_METRIC_SCHEMA,
        date_column="recorded_on",
    ),    
}

BRONZE_TO_SILVER_PIPELINES: dict[str, BronzeToSilverRegistration] = {
    "event-data": BronzeToSilverRegistration(
        data_product_id="event-data",
        pipeline_name="event-bronze-to-silver",
        pipeline_version="1.0",
        mapping_id="event-data-to-event",
        silver_entity="event",
        gold_products=["event-performance"],
    ),
    # The portal's real self-service Upload page has no "event-data" entry
    # in its dataset catalog -- the closest match a customer can actually
    # pick is "Event Performance" (src/data/mocks/datasets.ts id
    # "ds-event-performance"), whose declared schema (event_id, venue_id,
    # event_date, tickets_sold, gross_revenue) is identical to event-data's.
    # Reuses the same mapping/silver entity: `MappingConfig.source.table`/
    # `.source_data_product_id` are documentation only (never matched
    # against the actual Bronze table the runner reads -- see
    # `pipeline_context.resolve_bronze_ready`, which resolves the physical
    # table from the ingestion run, not from the mapping config), so one
    # mapping file can genuinely serve two Bronze data products with the
    # same column shape.
    "ds-event-performance": BronzeToSilverRegistration(
        data_product_id="ds-event-performance",
        pipeline_name="ds-event-performance-bronze-to-silver",
        pipeline_version="1.0",
        mapping_id="event-data-to-event",
        silver_entity="event",
        gold_products=["event-performance"],
    ),
    # Synthetic test data product (cdep Dataset "Test Metrics") -- see
    # data-exchange-service/TEST-DataProduct-onboarding.MD for the full
    # onboarding runbook this registration is a worked example of.
    "ds-test-metrics-789c08": BronzeToSilverRegistration(
        data_product_id="ds-test-metrics-789c08",
        pipeline_name="test-metrics-bronze-to-silver",
        pipeline_version="1.0",
        mapping_id="test-metrics-to-test-metric",
        silver_entity="test_metric",
        gold_products=["test-metric-summary"],
    ),
    # Synthetic ranjay test data product (cdep Dataset "Ranjay Test Metrics") -- see
    # data-exchange-service/TEST-DataProduct-onboarding.MD for the full
    # onboarding runbook this registration is a worked example of.
    "ds-ranjay-test-metrics-b31235": BronzeToSilverRegistration(
        data_product_id="ds-ranjay-test-metrics-b31235",
        pipeline_name="ranjay-test-metrics-bronze-to-silver",
        pipeline_version="1.0",
        mapping_id="ranjay-test-metrics-to-ranjay-test-metric",
        silver_entity="ranjay_test_metric",
        gold_products=["ranjay-test-metric-summary"],
    ),
}

SILVER_TO_GOLD_PIPELINES: dict[str, SilverToGoldRegistration] = {
    "event-performance": SilverToGoldRegistration(
        data_product_id="event-performance",
        pipeline_name="event-performance-silver-to-gold",
        pipeline_version="1.0",
        source_silver_entity="event",
        gold_table_name="event_performance",
        schema=GOLD_EVENT_PERFORMANCE_SCHEMA,
        date_column="event_date",
        grain_key=GOLD_EVENT_PERFORMANCE_GRAIN_KEY,
        builder=build_event_performance,
    ),
    "test-metric-summary": SilverToGoldRegistration(
        data_product_id="test-metric-summary",
        pipeline_name="test-metric-summary-silver-to-gold",
        pipeline_version="1.0",
        source_silver_entity="test_metric",
        gold_table_name="test_metric_summary",
        schema=GOLD_TEST_METRIC_SUMMARY_SCHEMA,
        date_column="recorded_on",
        grain_key=GOLD_TEST_METRIC_SUMMARY_GRAIN_KEY,
        builder=build_test_metric_summary,
    ),
    "ranjay-test-metric-summary": SilverToGoldRegistration(
        data_product_id="ranjay-test-metric-summary",
        pipeline_name="ranjay-test-metric-summary-silver-to-gold",
        pipeline_version="1.0",
        source_silver_entity="ranjay_test_metric",
        gold_table_name="ranjay_test_metric_summary",
        schema=GOLD_RANJAY_TEST_METRIC_SUMMARY_SCHEMA,
        date_column="recorded_on",
        grain_key=GOLD_RANJAY_TEST_METRIC_SUMMARY_GRAIN_KEY,
        builder=build_ranjay_test_metric_summary,
    ),
}
