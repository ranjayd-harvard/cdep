from __future__ import annotations

from enum import StrEnum


class PipelineType(StrEnum):
    BRONZE_TO_SILVER = "BRONZE_TO_SILVER"
    SILVER_TO_GOLD = "SILVER_TO_GOLD"


class PipelineStatus(StrEnum):
    CREATED = "CREATED"
    READING_SOURCE = "READING_SOURCE"
    VALIDATING = "VALIDATING"
    TRANSFORMING = "TRANSFORMING"
    WRITING = "WRITING"
    QUALITY_CHECK = "QUALITY_CHECK"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"
    SKIPPED_DUPLICATE = "SKIPPED_DUPLICATE"


TERMINAL_STATUSES = {
    PipelineStatus.COMPLETED,
    PipelineStatus.FAILED,
    PipelineStatus.SKIPPED_DUPLICATE,
}
