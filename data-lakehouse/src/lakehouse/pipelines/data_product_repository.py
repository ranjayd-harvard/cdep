"""Operational Data Product registry (AGENTS.md section 47).

Backed by PostgreSQL, schema `lakehouse`, table `data_products` -- see
sql/002_pipeline_metadata.sql for DDL + the `event-performance` seed row.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

import sqlalchemy as sa
from sqlalchemy import Engine


@dataclass
class DataProduct:
    data_product_id: str
    display_name: str
    version: str
    gold_table: str
    owner: str
    description: str | None
    status: str
    created_at: datetime
    updated_at: datetime


class DataProductRepository:
    def __init__(self, engine: Engine) -> None:
        self._engine = engine

    def list_all(self) -> list[DataProduct]:
        with self._engine.connect() as conn:
            rows = (
                conn.execute(sa.text("SELECT * FROM lakehouse.data_products ORDER BY data_product_id"))
                .mappings()
                .all()
            )
        return [DataProduct(**dict(r)) for r in rows]

    def get(self, data_product_id: str) -> DataProduct | None:
        with self._engine.connect() as conn:
            row = (
                conn.execute(
                    sa.text("SELECT * FROM lakehouse.data_products WHERE data_product_id = :id"),
                    {"id": data_product_id},
                )
                .mappings()
                .first()
            )
        return DataProduct(**dict(row)) if row else None
