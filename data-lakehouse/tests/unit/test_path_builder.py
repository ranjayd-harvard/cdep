from __future__ import annotations

from lakehouse.storage.path_builder import exchange_inbound_key, reject_key, reject_prefix


def test_exchange_inbound_key_passthrough():
    assert exchange_inbound_key("exc-1", "exchanges/exc-1/events.csv") == "exchanges/exc-1/events.csv"


def test_reject_prefix_shape():
    assert reject_prefix("event-data", "ing-1") == "rejects/event-data/ing-1/"


def test_reject_key_default_filename():
    assert reject_key("event-data", "ing-1") == "rejects/event-data/ing-1/rejects.jsonl"


def test_reject_key_custom_filename():
    assert reject_key("event-data", "ing-1", "custom.jsonl") == "rejects/event-data/ing-1/custom.jsonl"
