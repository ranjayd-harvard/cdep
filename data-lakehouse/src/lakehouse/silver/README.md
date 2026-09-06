# Silver

Implemented in Phase 3. See the root [README.md](../../../README.md#phase-3-bronze--silver--gold)
for the full write-up (contracts, mapping framework, dedup, quality,
lineage, MERGE semantics). Quick map of this package:

- `canonicalizer.py` — applies the configuration-driven Bronze->Silver
  mapping (`lakehouse.transformations.mapping`) and stamps lineage.
- `deduplicator.py` — business-key dedup within a batch.
- `quality.py` — runs the contract's quality rules + policy decision.
- `rejects.py` — quarantines canonicalization/quality failures as JSONL.
- `silver_writer.py` / `silver_reader.py` — Iceberg MERGE/upsert write path
  + tenant/pipeline-run-scoped reads.
- `lineage.py` — attaches `organization_id`/`tenant_id`/
  `source_exchange_id`/`source_ingestion_id`/`pipeline_run_id`/etc.
- `models/event.py` — the canonical Arrow schema for `silver.event`.

Orchestrated by `lakehouse.pipelines.pipeline_runner.run_bronze_to_silver`,
driven by `contracts/silver/event.yaml` +
`mappings/bronze_to_silver/event-data-to-event.yaml`.
