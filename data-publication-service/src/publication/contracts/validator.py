"""Consistency checks between a trusted GoldReady event and the resolved
publication contract (AGENTS.md section 6: "validate consistency against:
Data Product contract / Lakehouse table / tenant context / Gold snapshot").
"""

from __future__ import annotations

from publication.common.errors import ContractValidationError, MissingTenantContextError
from publication.models.contract import PublicationContract
from publication.models.gold_ready import GoldReadyContext


def validate_gold_ready_against_contract(
    gold_ready: GoldReadyContext, contract: PublicationContract
) -> None:
    if not gold_ready.organization_id or not gold_ready.tenant_id:
        raise MissingTenantContextError(
            "GoldReady is missing organization_id/tenant_id -- publication cannot proceed "
            "without a trusted tenant scope."
        )

    if gold_ready.data_product_id != contract.data_product_id:
        raise ContractValidationError(
            f"GoldReady dataProductId '{gold_ready.data_product_id}' does not match contract "
            f"'{contract.data_product_id}'."
        )

    if gold_ready.gold_table != contract.source.table:
        raise ContractValidationError(
            f"GoldReady goldTable '{gold_ready.gold_table}' does not match contract source table "
            f"'{contract.source.table}'."
        )

    if not gold_ready.gold_snapshot_id:
        raise ContractValidationError(
            "GoldReady is missing goldSnapshotId -- publication requires an exact Iceberg "
            "snapshot to read from (AGENTS.md section 10)."
        )
