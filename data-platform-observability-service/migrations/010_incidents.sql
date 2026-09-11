-- Lightweight alert correlation (spec section 24) — deliberately not a full
-- ITSM model. An incident groups alerts opened for the same
-- (tenant, product, version) scope within a configurable window; it
-- resolves automatically once every linked alert resolves.
CREATE TABLE incidents (
    incident_id VARCHAR(64) PRIMARY KEY,

    organization_id VARCHAR(64) NOT NULL,
    tenant_id VARCHAR(64) NOT NULL,
    data_product_id VARCHAR(128) NOT NULL,
    product_version VARCHAR(32) NOT NULL,

    title VARCHAR(255) NOT NULL,
    severity VARCHAR(20) NOT NULL CHECK (severity IN ('INFO', 'WARNING', 'CRITICAL')),
    state VARCHAR(20) NOT NULL DEFAULT 'OPEN' CHECK (state IN ('OPEN', 'RESOLVED')),

    opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE incident_alerts (
    incident_id VARCHAR(64) NOT NULL REFERENCES incidents (incident_id),
    alert_id VARCHAR(64) NOT NULL REFERENCES alerts (alert_id),
    linked_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (incident_id, alert_id)
);

CREATE INDEX ix_incidents_scope ON incidents (tenant_id, data_product_id, state);
