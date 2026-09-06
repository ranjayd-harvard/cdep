from publication.contracts.loader import load_publication_contract


def test_loads_event_performance_contract():
    contract = load_publication_contract("event-performance")
    assert contract.data_product_id == "event-performance"
    assert contract.version == "1.0"
    assert contract.source.table == "gold.event_performance"
    assert contract.grain == ["event_id"]
    assert [c.name for c in contract.published_schema] == [
        "event_id",
        "venue_id",
        "event_date",
        "tickets_sold",
        "gross_revenue",
        "revenue_per_ticket",
    ]
    assert "organization_id" not in {c.name for c in contract.published_schema}
    assert "tenant_id" not in {c.name for c in contract.published_schema}
    assert contract.default_format == "PARQUET"
    assert contract.publication.expiration_hours == 168
