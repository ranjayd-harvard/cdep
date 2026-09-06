from __future__ import annotations

import io
import json
from typing import BinaryIO

from lakehouse.config.models import JsonContractConfig
from lakehouse.readers.interface import RawRecord, ReadResult


class JsonReader:
    """Newline-delimited JSON reader. Nested structures are preserved as-is
    (AGENTS.md section 20) -- Bronze does not flatten them."""

    def __init__(self, contract: JsonContractConfig) -> None:
        self._contract = contract

    def read(self, stream: BinaryIO) -> ReadResult:
        text = io.TextIOWrapper(stream, encoding=self._contract.encoding)
        records: list[RawRecord] = []
        columns: set[str] = set()

        for row_number, line in enumerate(text, start=1):
            line = line.strip()
            if not line:
                continue
            try:
                data = json.loads(line)
            except json.JSONDecodeError as exc:
                records.append(RawRecord(row_number=row_number, data=None, error=str(exc)))
                continue
            if not isinstance(data, dict):
                records.append(
                    RawRecord(
                        row_number=row_number,
                        data=None,
                        error=f"expected a JSON object per line, got {type(data).__name__}",
                    )
                )
                continue
            records.append(RawRecord(row_number=row_number, data=data))
            columns.update(data.keys())

        return ReadResult(
            records=records,
            observed_columns=sorted(columns),
            source_record_count=len(records),
        )
