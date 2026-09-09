CREATE TABLE subscription_delivery_preferences (
    delivery_preference_id VARCHAR(64) PRIMARY KEY,

    subscription_id VARCHAR(64) NOT NULL REFERENCES subscriptions (subscription_id),

    delivery_method VARCHAR(30) NOT NULL CHECK (delivery_method IN ('FILE', 'API')),

    file_format VARCHAR(30),

    frequency VARCHAR(30) NOT NULL CHECK (frequency IN ('ON_DEMAND', 'DAILY', 'WEEKLY', 'MONTHLY')),

    delivery_time TIME,

    timezone VARCHAR(100),

    retention_days INTEGER,

    api_profile VARCHAR(100),

    configuration JSONB NOT NULL DEFAULT '{}'::jsonb,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    version BIGINT NOT NULL DEFAULT 1
);

-- One-to-one with the owning subscription for Phase 6 (spec §22).
CREATE UNIQUE INDEX ux_delivery_preferences_subscription
ON subscription_delivery_preferences (subscription_id);
