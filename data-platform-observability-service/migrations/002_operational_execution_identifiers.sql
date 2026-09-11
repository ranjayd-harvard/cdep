-- Join-key index (plan section 5) — the mechanism that makes correlation an
-- O(1) unique lookup per incoming event instead of an 8-nullable-column
-- scan of operational_executions. Every non-null foreign identifier seen on
-- any stage run/event is upserted here once, regardless of which column it
-- originally came from on the source service's own row.
CREATE TABLE operational_execution_identifiers (
    id_type VARCHAR(30) NOT NULL CHECK (
        id_type IN (
            'PUBLICATION_ID', 'GOLD_PIPELINE_RUN_ID', 'SILVER_PIPELINE_RUN_ID',
            'INGESTION_ID', 'INBOUND_EXCHANGE_ID', 'OUTBOUND_EXCHANGE_ID',
            'SCHEDULED_RUN_ID', 'SUBSCRIPTION_ID', 'DELIVERY_REQUEST_ID', 'API_REQUEST_ID'
        )
    ),
    id_value VARCHAR(128) NOT NULL,
    execution_id VARCHAR(64) NOT NULL REFERENCES operational_executions (execution_id),

    -- HEURISTIC marks an identifier attached via the (org, tenant, product,
    -- version, time-window) fallback rather than an exact ID match — kept
    -- for observability of the correlator's own accuracy (plan section 5).
    correlation_confidence VARCHAR(20) NOT NULL DEFAULT 'EXACT' CHECK (correlation_confidence IN ('EXACT', 'HEURISTIC')),

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (id_type, id_value)
);

CREATE INDEX ix_operational_execution_identifiers_execution ON operational_execution_identifiers (execution_id);
