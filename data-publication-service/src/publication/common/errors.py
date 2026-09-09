"""Error taxonomy for the publication service. Mirrors
data-lakehouse's `lakehouse.common.errors` shape deliberately (stable
`error_code` on every exception, safe to persist / report) -- see that
module for the precedent.
"""

from __future__ import annotations


class PublicationError(Exception):
    error_code: str = "PUBLICATION_ERROR"

    def __init__(self, message: str, *, error_code: str | None = None) -> None:
        super().__init__(message)
        self.message = message
        if error_code:
            self.error_code = error_code


class GoldReadyNotFoundError(PublicationError):
    error_code = "GOLD_READY_NOT_FOUND"


class ContractNotFoundError(PublicationError):
    error_code = "CONTRACT_NOT_FOUND"


class ContractValidationError(PublicationError):
    error_code = "CONTRACT_VALIDATION_FAILED"


class MissingTenantContextError(PublicationError):
    """No organization_id/tenant_id supplied -- publication must never run
    without an explicit tenant scope (AGENTS.md section 9)."""

    error_code = "MISSING_TENANT_CONTEXT"


class CrossTenantSafetyError(PublicationError):
    """The mandatory cross-tenant assertion (AGENTS.md section 28) failed --
    the scoped Gold read returned rows outside the trusted organization/
    tenant. Always aborts the publication."""

    error_code = "CROSS_TENANT_SAFETY_FAILED"


class GoldSnapshotNotFoundError(PublicationError):
    error_code = "GOLD_SNAPSHOT_NOT_FOUND"


class SchemaProjectionError(PublicationError):
    error_code = "SCHEMA_PROJECTION_FAILED"


class GrainViolationError(PublicationError):
    error_code = "GRAIN_VIOLATION"


class QualityGateFailedError(PublicationError):
    error_code = "QUALITY_GATE_FAILED"


class ExportError(PublicationError):
    error_code = "EXPORT_FAILED"


class ExchangeServiceError(PublicationError):
    error_code = "EXCHANGE_SERVICE_ERROR"


class CatalogServiceError(PublicationError):
    error_code = "CATALOG_SERVICE_ERROR"


class DuplicatePublicationError(PublicationError):
    """Not really an error -- raised internally to short-circuit into a
    SKIPPED_DUPLICATE outcome. See services/publication_service.py."""

    error_code = "SKIPPED_DUPLICATE"


class InvalidStateTransitionError(PublicationError):
    error_code = "INVALID_STATE_TRANSITION"
