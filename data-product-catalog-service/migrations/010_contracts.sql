-- The registered contract, verbatim (normalized JSON) plus provenance. The
-- catalog tables above (versions/schema fields/policies) hold the same
-- information in queryable, structured form — this table is the audit trail
-- and the source the internal contract API returns unmodified (spec §13/§28/§36).
CREATE TABLE catalog.contracts (
    contract_id                VARCHAR(64) PRIMARY KEY,

    data_product_version_id     VARCHAR(64) NOT NULL
        REFERENCES catalog.data_product_versions (data_product_version_id),

    contract_version               VARCHAR(32) NOT NULL,
    contract_format                  VARCHAR(16) NOT NULL,

    contract_body                      JSONB NOT NULL,
    contract_hash                       VARCHAR(64) NOT NULL,

    source_repository                    VARCHAR(255),
    source_path                            VARCHAR(512),
    source_commit                           VARCHAR(64),

    registered_by                            VARCHAR(255),
    registered_at                             TIMESTAMPTZ NOT NULL DEFAULT now(),

    status                                     VARCHAR(32) NOT NULL DEFAULT 'REGISTERED',

    CONSTRAINT contracts_format_chk CHECK (contract_format IN ('YAML', 'JSON')),
    CONSTRAINT contracts_status_chk CHECK (status IN ('REGISTERED', 'SUPERSEDED', 'INVALIDATED'))
);
