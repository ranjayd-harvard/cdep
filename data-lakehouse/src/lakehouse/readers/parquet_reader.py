from __future__ import annotations

from typing import BinaryIO

import pyarrow.parquet as pq

from lakehouse.readers.interface import RawRecord, ReadResult


class ParquetReader:
    """Parquet reader. Source types are preserved (AGENTS.md section 20) --
    values are handed to the Bronze writer as native Python objects derived
    directly from the Arrow table, without CSV/JSON-style stringification."""

    def read(self, stream: BinaryIO) -> ReadResult:
        table = pq.read_table(stream)
        rows = table.to_pylist()
        records = [RawRecord(row_number=i, data=row) for i, row in enumerate(rows, start=1)]
        return ReadResult(
            records=records,
            observed_columns=list(table.schema.names),
            source_record_count=len(records),
            native_arrow_fields=list(table.schema),
        )
