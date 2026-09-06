# Gold

Implemented in Phase 3. See the root [README.md](../../../README.md#phase-3-bronze--silver--gold)
for the full write-up (Data Product contracts, grain validation, MERGE
semantics, customer-facing contract vs. physical table). Quick map of this
package:

- `product_builder.py` — the `GoldProductBuilder` protocol every Data
  Product implements (pure Silver-rows-in, business-records-out logic).
- `products/event_performance.py` — the `event-performance` Data Product:
  Arrow schema, grain key, and `revenue_per_ticket` calculation (safe
  against `tickets_sold in (0, None)`).
- `quality.py` — runs the contract's quality rules + grain-uniqueness check.
- `gold_writer.py` / `gold_reader.py` — Iceberg MERGE/upsert write path +
  tenant-scoped reads.
- `lineage.py` — attaches `_gold_pipeline_run_id`/`_silver_pipeline_run_id`/
  `_product_id`/`_product_version`/etc.

Orchestrated by `lakehouse.pipelines.pipeline_runner.run_silver_to_gold`,
driven by `contracts/gold/event-performance.yaml`. Customer publication/
download packaging is explicitly out of scope for Phase 3 — see [Future
Publication Service](../../../README.md#future-publication-service).
