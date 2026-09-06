"""Facade tying the Iceberg catalog + TenantScopedGoldReader together for
callers that just want "give me this GoldReady's rows, safely"."""

from __future__ import annotations

from publication.lakehouse.iceberg_reader import get_catalog
from publication.lakehouse.tenant_scope import ScopedGoldRead, TenantScopedGoldReader
from publication.models.contract import PublicationContract
from publication.models.gold_ready import GoldReadyContext


def read_gold_for_publication(
    gold_ready: GoldReadyContext, contract: PublicationContract
) -> ScopedGoldRead:
    reader = TenantScopedGoldReader(get_catalog())
    return reader.read(gold_ready=gold_ready, contract=contract)
