-- Infrastructure/service health signal (spec section 32) — distinct from
-- Data Product health (operational_executions.health_status /
-- domain/health/health-score.ts). Rows here answer "is a sibling service
-- itself reachable/healthy", never "did this customer's data arrive on
-- time".
CREATE TABLE service_health (
    service_health_id BIGSERIAL PRIMARY KEY,

    service_name VARCHAR(64) NOT NULL,
    checked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    status VARCHAR(20) NOT NULL CHECK (status IN ('OK', 'DEGRADED', 'UNAVAILABLE')),
    latency_ms INTEGER,
    error_message TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ix_service_health_lookup ON service_health (service_name, checked_at DESC);
