from __future__ import annotations

import pytest

from lakehouse.config.settings import Settings


def _settings(storage_kind: str = "s3") -> Settings:
    return Settings(
        storage_kind=storage_kind,
        bucket_bronze="lakehouse-bronze",
        bucket_silver="lakehouse-silver",
        bucket_gold="lakehouse-gold",
    )


@pytest.mark.parametrize(
    "namespace,expected_bucket",
    [("bronze", "lakehouse-bronze"), ("silver", "lakehouse-silver"), ("gold", "lakehouse-gold")],
)
def test_bucket_for_namespace_routes_each_layer_to_its_own_bucket(namespace, expected_bucket):
    assert _settings().bucket_for_namespace(namespace) == expected_bucket


def test_bucket_for_unknown_namespace_raises():
    with pytest.raises(ValueError):
        _settings().bucket_for_namespace("platinum")


def test_location_for_table_uses_s3_scheme_and_namespace_bucket():
    settings = _settings("s3")
    assert settings.location_for_table("silver", "event") == "s3://lakehouse-silver/silver/event"
    assert settings.location_for_table("bronze", "event_data") == "s3://lakehouse-bronze/bronze/event_data"


def test_location_for_table_uses_gcs_scheme():
    settings = _settings("gcs")
    assert settings.location_for_table("gold", "event_performance") == (
        "gs://lakehouse-gold/gold/event_performance"
    )


def test_location_for_table_local_has_no_scheme_prefix():
    settings = _settings("local")
    assert settings.location_for_table("bronze", "event_data") == "lakehouse-bronze/bronze/event_data"
