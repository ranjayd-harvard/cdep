"""Technical ingestion validation (AGENTS.md section 23).

Deliberately narrow: checks that ingestion *can* proceed safely. Does not
repeat customer-facing business validation the Exchange Service already
performed.
"""

from __future__ import annotations

from lakehouse.common.errors import (
    DataProductNotConfiguredError,
    SourceObjectEmptyError,
    SourceObjectNotFoundError,
)
from lakehouse.config.models import DataProductContract
from lakehouse.exchange.models import ExchangeManifest, ExchangeReady
from lakehouse.storage.interface import StorageClient


def validate_technical_preconditions(
    *,
    exchange: ExchangeReady,
    manifest: ExchangeManifest,
    contract: DataProductContract,
    storage: StorageClient,
) -> list[str]:
    """Raises a `LakehouseError` subclass on the first failed check.
    Returns the list of checks that passed, for observability."""
    checks: list[str] = []

    assert manifest.ownership.organization_id
    assert manifest.ownership.tenant_id
    checks.append("organization_tenant_present")

    if manifest.exchange.exchange_id != exchange.exchange_id:
        raise DataProductNotConfiguredError(
            "Manifest exchange_id does not match requested exchange_id"
        )
    checks.append("exchange_id_matches_manifest")

    if manifest.data_product.data_product_id != contract.data_product_id:
        raise DataProductNotConfiguredError(
            f"Manifest data product '{manifest.data_product.data_product_id}' does not "
            f"match resolved contract '{contract.data_product_id}'"
        )
    checks.append("data_product_configured")

    assert manifest.storage_bucket and manifest.storage_key
    if not storage.exists(manifest.storage_bucket, manifest.storage_key):
        raise SourceObjectNotFoundError(
            f"Source object not found: {manifest.storage_bucket}/{manifest.storage_key}"
        )
    checks.append("source_object_exists")

    obj_meta = storage.metadata(manifest.storage_bucket, manifest.storage_key)
    if obj_meta.size_bytes == 0:
        raise SourceObjectEmptyError("Source object is empty")
    checks.append("source_object_non_empty")

    fmt = manifest.file.format.upper()
    if fmt not in contract.source_formats:
        from lakehouse.common.errors import UnsupportedFormatError

        raise UnsupportedFormatError(
            f"Format '{fmt}' not supported for data product '{contract.data_product_id}'"
        )
    checks.append("supported_format")

    if manifest.file.checksum and manifest.file.checksum_algorithm:
        actual = storage.checksum(
            manifest.storage_bucket, manifest.storage_key, manifest.file.checksum_algorithm
        )
        if actual.lower() != manifest.file.checksum.lower():
            from lakehouse.common.errors import SourceUnreadableError

            raise SourceUnreadableError(
                "Source object checksum does not match manifest-declared checksum"
            )
        checks.append("checksum_verified")

    return checks
