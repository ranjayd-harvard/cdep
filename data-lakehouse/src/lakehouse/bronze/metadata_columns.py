"""Required Bronze technical metadata columns (AGENTS.md section 18).

Every column here is documented so its meaning survives beyond any single
ingestion run.
"""

from __future__ import annotations

# Column name -> human-readable documentation. Keep this the single source
# of truth for "what technical columns does Bronze carry".
METADATA_COLUMN_DOCS: dict[str, str] = {
    "_organization_id": "Owning organization. Tenant-isolation boundary (outer).",
    "_tenant_id": "Owning tenant within the organization. Tenant-isolation boundary (inner).",
    "_exchange_id": "Exchange Service exchange that produced this record.",
    "_ingestion_id": "Ingestion attempt that wrote this record. One exchange may have many.",
    "_data_product_id": "Logical data product / Bronze table this record belongs to.",
    "_schema_version": "Schema version declared by the manifest at ingestion time.",
    "_source_file": "Original filename as uploaded by the customer.",
    "_source_path": "Storage bucket/key of the original object in exchange-inbound storage.",
    "_source_format": "Source file format: CSV | JSON | PARQUET.",
    "_source_received_at": "Timestamp the Exchange Service recorded the file as received.",
    "_ingested_at": "Timestamp this record was written to Bronze.",
    "_source_row_number": "1-based position of this record within the source file.",
    "_record_hash": "SHA-256 of the raw source record; a technical fingerprint, not a business key.",
    "_source_system": "Upstream system identifier (constant 'data-exchange-service' for Phase 2).",
    "_source_channel": "Ingestion channel declared by the manifest (e.g. CUSTOMER_PORTAL).",
}

METADATA_COLUMNS: list[str] = list(METADATA_COLUMN_DOCS.keys())

SOURCE_SYSTEM = "data-exchange-service"
