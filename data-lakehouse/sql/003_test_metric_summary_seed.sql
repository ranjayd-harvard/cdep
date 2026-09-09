-- Seeds the "test-metric-summary" Gold Data Product row so it's visible
-- via GET /internal/v1/data-products (the "Publish Gold Product" panel on
-- cdep's /admin/lakehouse/pipelines). Synthetic test product -- see
-- data-exchange-service/TEST-DataProduct-onboarding.MD for the full
-- onboarding runbook.
--
-- Mounted into the Postgres container's /docker-entrypoint-initdb.d/ so it
-- runs automatically on first `docker compose up` (fresh volume only). For
-- an already-initialized volume, apply by hand, e.g.:
--   docker exec -i data-lakehouse-postgres-1 psql -U lakehouse -d lakehouse < sql/003_test_metric_summary_seed.sql

INSERT INTO lakehouse.data_products (
    data_product_id, display_name, version, gold_table, owner, description, status
) VALUES (
    'test-metric-summary', 'Test Metric Summary', '1.0', 'gold.test_metric_summary',
    'Platform Test', 'Synthetic test Gold Data Product used to validate onboarding a brand-new data product end-to-end.', 'ACTIVE'
)
ON CONFLICT (data_product_id) DO NOTHING;
