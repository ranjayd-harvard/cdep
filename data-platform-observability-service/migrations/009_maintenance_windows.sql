-- Maintenance windows (spec section 23) — expected platform/service/product
-- downtime that should suppress alerts rather than create unnecessary
-- incidents. Auditable: created_by is always populated from the acting
-- internal actor's context, never anonymous.
CREATE TABLE maintenance_windows (
    maintenance_window_id VARCHAR(64) PRIMARY KEY,

    scope VARCHAR(20) NOT NULL CHECK (scope IN ('PLATFORM', 'SERVICE', 'PRODUCT', 'PRODUCT_VERSION', 'TENANT')),
    -- NULL only for scope = 'PLATFORM' (applies to everything). Otherwise
    -- holds the service name / data_product_id / "product_id:version" /
    -- tenant_id the window scopes to.
    scope_value VARCHAR(128),

    starts_at TIMESTAMPTZ NOT NULL,
    ends_at TIMESTAMPTZ NOT NULL,
    reason TEXT NOT NULL,
    created_by VARCHAR(128) NOT NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ix_maintenance_windows_active ON maintenance_windows (scope, scope_value, starts_at, ends_at);
