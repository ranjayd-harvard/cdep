from __future__ import annotations

from lakehouse.common.errors import UnsupportedFormatError
from lakehouse.config.models import DataProductContract
from lakehouse.readers.csv_reader import CsvReader
from lakehouse.readers.interface import RawRecord, ReadResult, SourceReader
from lakehouse.readers.json_reader import JsonReader
from lakehouse.readers.parquet_reader import ParquetReader

__all__ = ["RawRecord", "ReadResult", "SourceReader", "build_reader"]


def build_reader(source_format: str, contract: DataProductContract) -> SourceReader:
    fmt = source_format.upper()
    if fmt not in contract.source_formats:
        raise UnsupportedFormatError(
            f"Format '{fmt}' is not configured for data product "
            f"'{contract.data_product_id}' (allowed: {contract.source_formats})"
        )
    if fmt == "CSV":
        return CsvReader(contract.csv)
    if fmt == "JSON":
        return JsonReader(contract.json_)
    if fmt == "PARQUET":
        return ParquetReader()
    raise UnsupportedFormatError(f"No reader implemented for format '{fmt}'")
