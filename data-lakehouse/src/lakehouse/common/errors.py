"""Error taxonomy shared across the ingestion pipeline.

Every error carries a stable `error_code` so it can be persisted safely in
`lakehouse.ingestion_runs.error_code` and reported back to the Exchange
Service without leaking internal stack traces or file contents.
"""

from __future__ import annotations


class LakehouseError(Exception):
    """Base class for all Phase 2 lakehouse errors."""

    error_code: str = "LAKEHOUSE_ERROR"

    def __init__(self, message: str, *, error_code: str | None = None) -> None:
        super().__init__(message)
        self.message = message
        if error_code:
            self.error_code = error_code


class ManifestValidationError(LakehouseError):
    error_code = "MANIFEST_INVALID"


class ExchangeNotReadyError(LakehouseError):
    """Raised when an exchange is not in an ingestion-eligible state."""

    error_code = "EXCHANGE_NOT_READY"


class ExchangeNotFoundError(LakehouseError):
    error_code = "EXCHANGE_NOT_FOUND"


class DataProductNotConfiguredError(LakehouseError):
    error_code = "DATA_PRODUCT_NOT_CONFIGURED"


class SourceObjectNotFoundError(LakehouseError):
    error_code = "SOURCE_OBJECT_NOT_FOUND"


class SourceObjectEmptyError(LakehouseError):
    error_code = "SOURCE_OBJECT_EMPTY"


class UnsupportedFormatError(LakehouseError):
    error_code = "UNSUPPORTED_FORMAT"


class SchemaValidationError(LakehouseError):
    error_code = "SCHEMA_VALIDATION_FAILED"


class SourceUnreadableError(LakehouseError):
    error_code = "SOURCE_UNREADABLE"


class BronzeWriteError(LakehouseError):
    error_code = "BRONZE_WRITE_FAILED"


class DuplicateIngestionError(LakehouseError):
    """Raised (or caught) when an exchange has already been ingested."""

    error_code = "DUPLICATE_INGESTION"


# --- Phase 3: pipeline (Bronze->Silver / Silver->Gold) errors ---------------


class BronzeNotReadyError(LakehouseError):
    """Raised when Bronze->Silver is asked to process an ingestion_id that
    doesn't exist or hasn't reached a COMPLETED Bronze write."""

    error_code = "BRONZE_NOT_READY"


class SilverNotReadyError(LakehouseError):
    """Raised when Silver->Gold is asked to process a pipeline_run_id that
    doesn't exist or wasn't a COMPLETED BRONZE_TO_SILVER run."""

    error_code = "SILVER_NOT_READY"


class PipelineRunNotFoundError(LakehouseError):
    error_code = "PIPELINE_RUN_NOT_FOUND"


class PipelineNotConfiguredError(LakehouseError):
    """Raised when a data_product_id/entity has no registry entry."""

    error_code = "PIPELINE_NOT_CONFIGURED"


class SilverWriteError(LakehouseError):
    error_code = "SILVER_WRITE_FAILED"


class GoldWriteError(LakehouseError):
    error_code = "GOLD_WRITE_FAILED"


class QualityPolicyFailedError(LakehouseError):
    """Raised when a quality policy's fail_pipeline condition is met."""

    error_code = "QUALITY_POLICY_FAILED"
