from __future__ import annotations

from functools import lru_cache

import yaml

from lakehouse.config.settings import CONTRACTS_DIR
from lakehouse.contracts.models import GoldDataProductContract, SilverContract


def _read_yaml(path) -> dict:
    if not path.exists():
        raise FileNotFoundError(f"No contract configured at: {path}")
    with open(path) as f:
        return yaml.safe_load(f)


@lru_cache
def load_silver_contract(entity: str) -> SilverContract:
    data = _read_yaml(CONTRACTS_DIR / "silver" / f"{entity}.yaml")
    return SilverContract(**data)


@lru_cache
def load_gold_contract(data_product_id: str) -> GoldDataProductContract:
    data = _read_yaml(CONTRACTS_DIR / "gold" / f"{data_product_id}.yaml")
    return GoldDataProductContract(**data)
