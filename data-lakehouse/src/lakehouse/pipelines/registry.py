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
from lakehouse.silver.models.event import SILVER_EVENT_SCHEMA


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
}
