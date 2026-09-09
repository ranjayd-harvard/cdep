"""Error taxonomy for the serving projection service. Mirrors
data-publication-service's `publication.common.errors` shape deliberately
(stable `error_code` on every exception) -- see that module for precedent.
"""

from __future__ import annotations


class ServingProjectionError(Exception):
    error_code: str = "SERVING_PROJECTION_ERROR"

    def __init__(self, message: str, *, error_code: str | None = None) -> None:
        super().__init__(message)
        self.message = message
        if error_code:
            self.error_code = error_code


class GoldSnapshotNotFoundError(ServingProjectionError):
    error_code = "GOLD_SNAPSHOT_NOT_FOUND"


class ProjectionValidationError(ServingProjectionError):
    """A full-refresh staging load failed validation (spec §8.4) -- the
    live table must never be touched when this is raised."""

    error_code = "PROJECTION_VALIDATION_FAILED"


class NoPriorSuccessfulRunError(ServingProjectionError):
    """Incremental refresh requested with no prior SUCCEEDED run to
    checkpoint from -- caller must run a FULL refresh first."""

    error_code = "NO_PRIOR_SUCCESSFUL_RUN"


class ProjectionRunNotFoundError(ServingProjectionError):
    error_code = "PROJECTION_RUN_NOT_FOUND"
