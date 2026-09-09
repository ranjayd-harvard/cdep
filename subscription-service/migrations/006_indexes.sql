-- spec §44
CREATE INDEX ix_entitlements_lookup
ON entitlements (organization_id, tenant_id, data_product_id);

CREATE INDEX ix_subscriptions_tenant
ON subscriptions (organization_id, tenant_id);

CREATE INDEX ix_subscriptions_delivery_candidates
ON subscriptions (status, data_product_id);

CREATE INDEX ix_delivery_preferences_method_frequency
ON subscription_delivery_preferences (delivery_method, frequency);

CREATE INDEX ix_audit_events_entity
ON subscription_audit_events (entity_type, entity_id, created_at DESC);
