# event-data samples

- `events.csv`, `events_tenant_b.csv`, `events.ndjson`, `events.parquet` —
  sample source files, one per format, used by `make ingest-sample` /
  `scripts/create_sample_exchange.py`.
- `events_with_bad_row.csv` — one malformed row (extra trailing column), for
  exercising the reject/quarantine path.
- `manifest.json` — a **reference example** of the manifest shape
  (AGENTS.md section 12), for documentation only. It is not read directly:
  `scripts/create_sample_exchange.py` builds and stages a real manifest
  (with a live checksum) alongside whichever data file you pass it, under
  `exchange-inbound/exchanges/{exchange_id}/`.
