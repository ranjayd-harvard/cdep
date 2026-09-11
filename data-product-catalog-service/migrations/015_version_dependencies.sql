-- Phase 10 §8: declared version-range dependencies between Data Products
-- (e.g. "Event Revenue Summary 2.0 depends on Event Performance >=1.2 <2.0"),
-- used by the retirement guard (spec §21 point 5) to block retiring a
-- version that an active/beta dependent product still requires.
--
-- max_version is EXCLUSIVE, min_version is INCLUSIVE, by convention —
-- documented once here rather than re-derived per call site.
--
-- declareDependency does not require depends_on_data_product_id's version
-- range to currently have any matching version created yet (a dependency
-- can be declared against a range before every version in it exists), so
-- there is deliberately no FK/CHECK tying min_version/max_version to actual
-- rows in data_product_versions.
CREATE TABLE catalog.version_dependencies (
    version_dependency_id       VARCHAR(64)  PRIMARY KEY,

    dependent_data_product_id     VARCHAR(128) NOT NULL REFERENCES catalog.data_products (data_product_id),
    dependent_version                VARCHAR(32)  NOT NULL,

    depends_on_data_product_id         VARCHAR(128) NOT NULL REFERENCES catalog.data_products (data_product_id),
    min_version                           VARCHAR(32)  NOT NULL,
    max_version                              VARCHAR(32),

    created_at                                  TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT version_dependencies_unique UNIQUE
        (dependent_data_product_id, dependent_version, depends_on_data_product_id)
);

CREATE INDEX version_dependencies_depends_on_idx
    ON catalog.version_dependencies (depends_on_data_product_id);
