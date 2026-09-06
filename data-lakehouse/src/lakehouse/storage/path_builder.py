"""Trusted path construction.

Never builds paths from caller-supplied/arbitrary input (AGENTS.md section
52). All paths here are derived from IDs that already came from trusted
Exchange/manifest context.
"""

from __future__ import annotations


def exchange_inbound_key(exchange_id: str, object_key: str) -> str:
    """The exchange-inbound object key is owned by the Exchange Service and
    passed through verbatim from its manifest -- the lakehouse does not
    invent or guess it."""
    return object_key


def reject_prefix(data_product_id: str, ingestion_id: str) -> str:
    return f"rejects/{data_product_id}/{ingestion_id}/"


def reject_key(data_product_id: str, ingestion_id: str, filename: str = "rejects.jsonl") -> str:
    return f"{reject_prefix(data_product_id, ingestion_id)}{filename}"
