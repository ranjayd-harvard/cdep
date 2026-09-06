-- Supplementary indexes supporting known access patterns not already
-- covered by primary keys or the indexes created alongside their tables.

-- Look up which tenants a given user belongs to (session/tenant switching).
CREATE INDEX tenant_memberships_user_id_idx ON exchange.tenant_memberships (user_id);

-- Correlation-ID lookup for support/debugging (not an authorization key).
CREATE INDEX exchanges_correlation_id_idx ON exchange.exchanges (correlation_id) WHERE correlation_id IS NOT NULL;

-- Filter exchange_files by role within an exchange (e.g. fetch the MANIFEST).
CREATE INDEX exchange_files_exchange_id_role_idx ON exchange.exchange_files (exchange_id, file_role);

-- Active/enabled data product lookups.
CREATE INDEX data_products_status_idx ON exchange.data_products (status);

-- Entitlement lookups by data product (e.g. "which tenants can upload X").
CREATE INDEX tenant_dp_entitlements_data_product_idx ON exchange.tenant_data_product_entitlements (data_product_id);
