"""Source reader abstraction (AGENTS.md sections 6/20).

Readers preserve source fidelity: no renaming, no type coercion beyond what
the format itself implies, no business validation. Ambiguous values (e.g.
CSV cells) are kept as raw strings rather than inferred.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any, BinaryIO, Protocol

if TYPE_CHECKING:
    import pyarrow as pa


@dataclass
class RawRecord:
    """One source record plus its position, so a failure at read-time can be
    quarantined without losing every other record in the file."""

    row_number: int
    data: dict[str, Any] | None
    error: str | None = None


@dataclass
class ReadResult:
    records: list[RawRecord]
    observed_columns: list[str] = field(default_factory=list)
    source_record_count: int = 0
    # Populated only by typed-source readers (Parquet) so Bronze can
    # preserve native Arrow types instead of stringifying business columns.
    native_arrow_fields: list[pa.Field] | None = None

    @property
    def valid_records(self) -> list[RawRecord]:
        return [r for r in self.records if r.error is None]

    @property
    def rejected_records(self) -> list[RawRecord]:
        return [r for r in self.records if r.error is not None]


class SourceReader(Protocol):
    def read(self, stream: BinaryIO) -> ReadResult: ...
