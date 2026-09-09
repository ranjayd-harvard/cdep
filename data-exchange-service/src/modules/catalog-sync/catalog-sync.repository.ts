import { pool } from "../../database/pool.js";

// Single source of truth for the upsert SQL that keeps this service's
// Postgres catalog aligned with cdep's live MongoDB catalog. Used both by
// `scripts/sync-cdep-catalog.ts` (the on-demand, full-catalog reconciler)
// and by `catalog-sync.routes.ts` (real-time, per-entity pushes triggered
// from cdep's own write paths) — see docs/exchange-service-integration.md
// § "Keeping catalogs in sync". Keeping the SQL here instead of duplicated
// in both callers means the two sync paths can never drift from each
// other, even if they drift from cdep's actual data (which is what the
// on-demand script exists to catch and fix).

export async function upsertOrganization(organizationId: string, displayName: string): Promise<void> {
  await pool.query(
    `INSERT INTO exchange.organizations (organization_id, display_name, status)
     VALUES ($1, $2, 'ACTIVE')
     ON CONFLICT (organization_id) DO UPDATE SET display_name = EXCLUDED.display_name`,
    [organizationId, displayName],
  );
}

export async function upsertTenant(tenantId: string, organizationId: string, displayName: string): Promise<void> {
  await pool.query(
    `INSERT INTO exchange.tenants (tenant_id, organization_id, display_name, status)
     VALUES ($1, $2, $3, 'ACTIVE')
     ON CONFLICT (tenant_id) DO UPDATE SET organization_id = EXCLUDED.organization_id, display_name = EXCLUDED.display_name`,
    [tenantId, organizationId, displayName],
  );
}

export async function upsertMembership(
  userId: string,
  organizationId: string,
  tenantId: string,
  role: string,
): Promise<void> {
  await pool.query(
    `INSERT INTO exchange.tenant_memberships (user_id, organization_id, tenant_id, role, status)
     VALUES ($1, $2, $3, $4, 'ACTIVE')
     ON CONFLICT (user_id, organization_id, tenant_id) DO UPDATE SET role = EXCLUDED.role`,
    [userId, organizationId, tenantId, role],
  );
}

// Every cdep Dataset becomes a data-exchange-service data product in its
// own right (this service has no separate DataProduct/Dataset tier — see
// docs/exchange-service-integration.md "Catalog model mismatch"). Always
// BIDIRECTIONAL: cdep doesn't track upload-vs-download intent per dataset,
// only per Exchange instance.
export async function upsertDataProduct(
  dataProductId: string,
  name: string,
  description: string,
  currentSchemaVersion: string,
): Promise<void> {
  await pool.query(
    `INSERT INTO exchange.data_products (data_product_id, name, description, direction, current_schema_version, status)
     VALUES ($1, $2, $3, 'BIDIRECTIONAL', $4, 'ACTIVE')
     ON CONFLICT (data_product_id) DO UPDATE SET
       name = EXCLUDED.name, description = EXCLUDED.description, current_schema_version = EXCLUDED.current_schema_version`,
    [dataProductId, name, description, currentSchemaVersion],
  );
}

export async function upsertEntitlement(
  tenantId: string,
  dataProductId: string,
  canUpload: boolean,
  canDownload: boolean,
): Promise<void> {
  await pool.query(
    `INSERT INTO exchange.tenant_data_product_entitlements (tenant_id, data_product_id, can_upload, can_download, status)
     VALUES ($1, $2, $3, $4, 'ACTIVE')
     ON CONFLICT (tenant_id, data_product_id) DO UPDATE SET
       can_upload = EXCLUDED.can_upload, can_download = EXCLUDED.can_download`,
    [tenantId, dataProductId, canUpload, canDownload],
  );
}
