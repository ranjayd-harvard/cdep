"""Silver/Gold contract models + loaders (AGENTS.md Phase 3 sections 10/23).

Distinct from `lakehouse.config.models.DataProductContract`, which describes
the Bronze *technical* ingestion contract. These describe the canonical
enterprise entity (Silver) and the published Data Product (Gold).
"""

from __future__ import annotations

from lakehouse.contracts.loader import load_gold_contract, load_silver_contract
from lakehouse.contracts.models import (
    GoldDataProductContract,
    QualityRuleConfig,
    SilverContract,
)

__all__ = [
    "SilverContract",
    "GoldDataProductContract",
    "QualityRuleConfig",
    "load_silver_contract",
    "load_gold_contract",
]
