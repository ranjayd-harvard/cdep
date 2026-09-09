-- Supplementary indexes supporting known access patterns not already
-- covered by primary keys or unique constraints created alongside their
-- tables.

-- Enforce "at most one ACTIVE version per product" (spec §10) at the
-- database layer, not just in application code.
CREATE UNIQUE INDEX product_versions_one_active_idx
    ON catalog.data_product_versions (data_product_id)
    WHERE lifecycle_status = 'ACTIVE';

-- Product discovery/search (spec §39).
CREATE INDEX data_products_domain_idx ON catalog.data_products (domain_id);
CREATE INDEX data_products_status_idx ON catalog.data_products (status);
CREATE INDEX data_products_discoverable_idx ON catalog.data_products (discoverable) WHERE discoverable = true;
CREATE INDEX data_products_name_idx ON catalog.data_products (lower(name));

-- Version lookups scoped to a product; ordinal-preserving schema reads.
CREATE INDEX product_versions_product_id_idx ON catalog.data_product_versions (data_product_id);
CREATE INDEX product_versions_lifecycle_idx ON catalog.data_product_versions (lifecycle_status);
CREATE INDEX schema_fields_version_ordinal_idx ON catalog.product_schema_fields (data_product_version_id, ordinal);

-- Delivery-method filtering (spec §39).
CREATE INDEX delivery_methods_version_idx ON catalog.supported_delivery_methods (data_product_version_id);
CREATE INDEX delivery_methods_method_idx ON catalog.supported_delivery_methods (method) WHERE enabled = true;

-- Duplicate-registration / hash-based lookups (spec §16/§17).
CREATE INDEX contracts_version_idx ON catalog.contracts (data_product_version_id);
CREATE INDEX contracts_hash_idx ON catalog.contracts (contract_hash);
CREATE INDEX contracts_status_idx ON catalog.contracts (status);

-- Registration/audit history queries (spec §36).
CREATE INDEX registration_events_product_idx ON catalog.registration_events (data_product_id, occurred_at DESC);
CREATE INDEX registration_events_type_idx ON catalog.registration_events (event_type);
