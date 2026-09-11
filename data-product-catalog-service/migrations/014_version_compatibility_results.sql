-- Phase 10 §7: persisted, explainable compatibility diffs. One row per
-- compatibility *evaluation*, not per version — re-registration attempts
-- and dry-run `evaluate-compatibility` calls (spec §23) both record a row,
-- so the audit trail includes rejected/superseded attempts, not just the
-- version that ultimately got created.
CREATE TABLE catalog.version_compatibility_results (
    compatibility_result_id  VARCHAR(64)  PRIMARY KEY,

    data_product_id            VARCHAR(128) NOT NULL REFERENCES catalog.data_products (data_product_id),

    from_version                 VARCHAR(32),   -- NULL = first version of the product
    to_version                     VARCHAR(32)  NOT NULL,

    compatibility_level              VARCHAR(16)  NOT NULL
        CHECK (compatibility_level IN ('METADATA_ONLY', 'NON_BREAKING', 'BREAKING')),

    -- [{type, field?, method?, filter?, detail}, ...] — closed `type`
    -- vocabulary enforced in application code (compatibility.service.ts),
    -- not at the DB layer.
    changes                             JSONB        NOT NULL DEFAULT '[]'::jsonb,

    evaluated_at                          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX version_compatibility_results_product_idx
    ON catalog.version_compatibility_results (data_product_id, evaluated_at DESC);
CREATE INDEX version_compatibility_results_pair_idx
    ON catalog.version_compatibility_results (data_product_id, from_version, to_version);
