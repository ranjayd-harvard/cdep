"""Bronze write path: lineage attachment -> schema resolution -> Iceberg
append (AGENTS.md sections 17/25). Append-only: a new ingestion never
rewrites Bronze history, it adds a new batch distinguished by
`_exchange_id` / `_ingestion_id` / `_tenant_id`.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

import pyarrow as pa
import structlog
from pyiceberg.catalog import Catalog

from lakehouse.bronze.bronze_table import qualified_name, resolve_bronze_table
from lakehouse.bronze.coercion import coerce_business_record
from lakehouse.bronze.lineage import attach_lineage
from lakehouse.bronze.schema import build_bronze_schema
from lakehouse.common.errors import BronzeWriteError
from lakehouse.config.models import DataProductContract
from lakehouse.config.settings import Settings
from lakehouse.exchange.models import ExchangeManifest
from lakehouse.ingestion.ingestion_context import IngestionContext
from lakehouse.readers.interface import RawRecord

log = structlog.get_logger(__name__)


@dataclass
class BronzeWriteResult:
    bronze_table: str
    record_count: int
    # Records that read successfully but failed contract-type coercion
    # (e.g. non-numeric text in a field declared numeric). Quarantined
    # alongside reader-level rejects, never silently dropped.
    coercion_rejects: list[RawRecord]


def write_bronze(
    catalog: Catalog,
    *,
    contract: DataProductContract,
    context: IngestionContext,
    manifest: ExchangeManifest,
    valid_records: list[RawRecord],
    ingested_at: datetime,
    settings: Settings,
    native_fields: list[pa.Field] | None = None,
) -> BronzeWriteResult:
    contract_fields = contract.schema_.fields

    coerced_records: list[RawRecord] = []
    coercion_rejects: list[RawRecord] = []
    for r in valid_records:
        result = coerce_business_record(r.data, contract_fields)  # type: ignore[arg-type]
        if result.error:
            coercion_rejects.append(RawRecord(row_number=r.row_number, data=r.data, error=result.error))
        else:
            coerced_records.append(RawRecord(row_number=r.row_number, data=result.record))

    business_columns = sorted({k for r in coerced_records for k in (r.data or {}).keys()})
    target_schema = build_bronze_schema(
        business_columns, contract_fields=contract_fields, native_fields=native_fields
    )

    lineage_records = [
        attach_lineage(
            r.data,  # type: ignore[arg-type]
            context=context,
            manifest=manifest,
            row_number=r.row_number,
            ingested_at=ingested_at,
        )
        for r in coerced_records
    ]

    try:
        arrow_table = pa.Table.from_pylist(lineage_records, schema=target_schema)
    except (pa.ArrowInvalid, pa.ArrowTypeError) as exc:
        raise BronzeWriteError(f"Failed to build Arrow table for Bronze write: {exc}") from exc

    table = resolve_bronze_table(
        catalog,
        target=contract.bronze,
        schema=target_schema,
        schema_mode=contract.schema_.mode,
        settings=settings,
    )

    try:
        # Append against the reconciled table schema: align columns so
        # `table.append` never fails on ordering differences after a
        # schema-evolution union. Under PERMISSIVE mode (e.g. a
        # no-fixed-schema contract like ds-event-performance), an earlier
        # ingestion may have already widened the table with columns this
        # batch doesn't have -- pad those as nulls rather than failing,
        # since `.select()` alone requires every requested column to exist.
        target_arrow_schema = table.schema().as_arrow()
        target_names = list(target_arrow_schema.names)
        missing = [n for n in target_names if n not in arrow_table.column_names]
        for name in missing:
            field = target_arrow_schema.field(name)
            arrow_table = arrow_table.append_column(field, pa.nulls(arrow_table.num_rows, type=field.type))
        aligned = arrow_table.select(target_names)
        table.append(aligned)
    except Exception as exc:  # noqa: BLE001 - convert to a stable error code
        raise BronzeWriteError(f"Bronze append failed: {exc}") from exc

    log.info(
        "bronze.write.completed",
        table=qualified_name(contract.bronze),
        ingestion_id=context.ingestion_id,
        exchange_id=context.exchange_id,
        tenant_id=context.tenant_id,
        record_count=len(lineage_records),
    )

    return BronzeWriteResult(
        bronze_table=qualified_name(contract.bronze),
        record_count=len(lineage_records),
        coercion_rejects=coercion_rejects,
    )
