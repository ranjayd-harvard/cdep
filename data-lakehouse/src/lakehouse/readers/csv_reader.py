from __future__ import annotations

import csv
import io
from typing import BinaryIO

from lakehouse.config.models import CsvContractConfig
from lakehouse.readers.interface import RawRecord, ReadResult


class CsvReader:
    """CSV reader that preserves every field as a raw string -- schema
    inference is intentionally not performed (AGENTS.md section 20)."""

    def __init__(self, contract: CsvContractConfig) -> None:
        self._contract = contract

    def read(self, stream: BinaryIO) -> ReadResult:
        text = io.TextIOWrapper(stream, encoding=self._contract.encoding, newline="")
        reader = csv.DictReader(text, delimiter=self._contract.delimiter)
        if reader.fieldnames is None:
            return ReadResult(records=[], observed_columns=[], source_record_count=0)

        records: list[RawRecord] = []
        for row_number, row in enumerate(reader, start=1):
            if None in row:
                records.append(
                    RawRecord(
                        row_number=row_number,
                        data=None,
                        error=f"row has more fields than header ({len(reader.fieldnames)} expected)",
                    )
                )
                continue
            records.append(RawRecord(row_number=row_number, data=dict(row)))

        return ReadResult(
            records=records,
            observed_columns=list(reader.fieldnames),
            source_record_count=len(records),
        )
