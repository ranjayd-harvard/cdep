from __future__ import annotations

from functools import lru_cache

import yaml

from publication.common.errors import ContractNotFoundError
from publication.config.settings import get_settings
from publication.models.contract import PublicationContract


@lru_cache
def load_publication_contract(data_product_id: str) -> PublicationContract:
    path = get_settings().contracts_dir_path / f"{data_product_id}.yaml"
    if not path.exists():
        raise ContractNotFoundError(f"No publication contract configured for '{data_product_id}': {path}")
    with open(path) as f:
        data = yaml.safe_load(f)
    return PublicationContract(**data)
