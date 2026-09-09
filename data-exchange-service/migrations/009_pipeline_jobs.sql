-- Durable queue for the real Bronze -> Silver -> Gold -> Publish pipeline,
-- decoupled from the upload request that triggers it. Enqueued by
-- modules/pipeline-jobs/ (called from cdep's exchange-api-upload-service.ts
-- when DEMO_FIXTURE_PUBLISH_ENABLED=false), processed by this service's own
-- pipeline worker (see src/pipeline-worker/) on its own schedule -- see
-- docs/exchange-service-integration.md.
CREATE TABLE exchange.pipeline_jobs (
    job_id VARCHAR(64) PRIMARY KEY,

    organization_id      VARCHAR(64) NOT NULL REFERENCES exchange.organizations (organization_id),
    tenant_id            VARCHAR(64) NOT NULL REFERENCES exchange.tenants (tenant_id),
    data_product_id      VARCHAR(64) NOT NULL REFERENCES exchange.data_products (data_product_id),
    source_exchange_id   VARCHAR(64) NOT NULL REFERENCES exchange.exchanges (exchange_id),
    outbound_exchange_id VARCHAR(64) REFERENCES exchange.exchanges (exchange_id),

    status        VARCHAR(32) NOT NULL DEFAULT 'PENDING',
    current_stage VARCHAR(32),
    attempts      INT NOT NULL DEFAULT 0,
    error_code    VARCHAR(64),
    error_message TEXT,

    started_at   TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT pipeline_jobs_status_chk CHECK (status IN ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED')),
    CONSTRAINT pipeline_jobs_stage_chk CHECK (
        current_stage IS NULL OR current_stage IN ('INGEST', 'BRONZE_TO_SILVER', 'SILVER_TO_GOLD', 'PUBLISH')
    )
);

-- Polled by the worker for the oldest unclaimed job (see
-- claimNextPendingJob's FOR UPDATE SKIP LOCKED query).
CREATE INDEX pipeline_jobs_status_idx ON exchange.pipeline_jobs (status, created_at);
CREATE INDEX pipeline_jobs_org_tenant_idx ON exchange.pipeline_jobs (organization_id, tenant_id);

ALTER TABLE exchange.pipeline_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY pipeline_jobs_tenant_isolation ON exchange.pipeline_jobs
    USING (
        organization_id = current_setting('app.organization_id', true)
        AND tenant_id = current_setting('app.tenant_id', true)
    );
