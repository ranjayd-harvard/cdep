from datetime import date
from decimal import Decimal

from publication.contracts.loader import load_publication_contract
from publication.quality.publication_quality import evaluate_publication_quality
from publication.transformations.projection import project_published_schema

CONTRACT = load_publication_contract("event-performance")


def _row(event_id: str) -> dict:
    return {
        "organization_id": "org-a",
        "tenant_id": "tenant-a",
        "event_id": event_id,
        "venue_id": "ven-1",
        "event_date": date(2026, 9, 6),
        "tickets_sold": 10,
        "gross_revenue": Decimal("100.00"),
        "revenue_per_ticket": Decimal("10.00"),
    }


def test_quality_gate_passes_for_valid_rows():
    rows = [_row("evt-1"), _row("evt-2")]
    table = project_published_schema(rows, CONTRACT)
    decision = evaluate_publication_quality(rows=rows, projected_table=table, contract=CONTRACT, organization_id="org-a", tenant_id="tenant-a")
    assert not decision.should_fail_publication


def test_quality_gate_fails_on_duplicate_grain():
    rows = [_row("evt-1"), _row("evt-1")]
    table = project_published_schema(rows, CONTRACT)
    decision = evaluate_publication_quality(rows=rows, projected_table=table, contract=CONTRACT, organization_id="org-a", tenant_id="tenant-a")
    assert decision.should_fail_publication
    assert "GRAIN_UNIQUE" in decision.failed_rule_names


def test_quality_gate_fails_on_empty_artifact():
    decision = evaluate_publication_quality(rows=[], projected_table=project_published_schema([], CONTRACT), contract=CONTRACT, organization_id="org-a", tenant_id="tenant-a")
    assert decision.should_fail_publication
    assert "ARTIFACT_NON_EMPTY" in decision.failed_rule_names
