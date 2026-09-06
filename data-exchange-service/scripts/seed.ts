import { pool } from "../src/database/pool.js";
import { logger } from "../src/common/logger/logger.js";

const ORG_ID = "org-vobis-org-722aea";
const TENANT_ID = "tenant-default-47d849";
const USER_ID = "usr-8a74b91";

// A second tenant/user pair exists purely to exercise multi-tenant
// isolation in tests and manual verification (AGENTS.md section 52).
const ORG_B_ID = "org-globex-org-9c1f2d";
const TENANT_B_ID = "tenant-default-b19e21";
const USER_B_ID = "usr-3f0d221";

const DATA_PRODUCTS: Array<{ id: string; name: string; direction: string; description: string }> = [
  { id: "event-data", name: "Event Data", direction: "INBOUND", description: "Raw customer event stream uploads." },
  { id: "transaction-data", name: "Transaction Data", direction: "INBOUND", description: "Financial transaction batch uploads." },
  { id: "inventory-data", name: "Inventory Data", direction: "INBOUND", description: "Inventory snapshot uploads." },
  { id: "event-performance", name: "Event Performance", direction: "OUTBOUND", description: "Published event performance rollups." },
  { id: "settlement-summary", name: "Settlement Summary", direction: "OUTBOUND", description: "Published settlement summaries." },
];

async function seedOrgTenantUser(orgId: string, orgName: string, tenantId: string, tenantName: string, userId: string) {
  await pool.query(
    `INSERT INTO exchange.organizations (organization_id, display_name, status)
     VALUES ($1, $2, 'ACTIVE')
     ON CONFLICT (organization_id) DO UPDATE SET display_name = EXCLUDED.display_name`,
    [orgId, orgName],
  );
  await pool.query(
    `INSERT INTO exchange.tenants (tenant_id, organization_id, display_name, status)
     VALUES ($1, $2, $3, 'ACTIVE')
     ON CONFLICT (tenant_id) DO UPDATE SET display_name = EXCLUDED.display_name`,
    [tenantId, orgId, tenantName],
  );
  await pool.query(
    `INSERT INTO exchange.tenant_memberships (user_id, organization_id, tenant_id, role, status)
     VALUES ($1, $2, $3, 'CUSTOMER_ADMIN', 'ACTIVE')
     ON CONFLICT (user_id, organization_id, tenant_id) DO UPDATE SET role = EXCLUDED.role`,
    [userId, orgId, tenantId],
  );
}

async function main() {
  await seedOrgTenantUser(ORG_ID, "Vobis Corporation", TENANT_ID, "Vobis Default Tenant", USER_ID);
  await seedOrgTenantUser(ORG_B_ID, "Globex Corporation", TENANT_B_ID, "Globex Default Tenant", USER_B_ID);

  for (const dp of DATA_PRODUCTS) {
    await pool.query(
      `INSERT INTO exchange.data_products (data_product_id, name, description, direction, current_schema_version, status)
       VALUES ($1, $2, $3, $4, '1.0', 'ACTIVE')
       ON CONFLICT (data_product_id) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description`,
      [dp.id, dp.name, dp.description, dp.direction],
    );

    for (const tenantId of [TENANT_ID, TENANT_B_ID]) {
      const canUpload = dp.direction === "INBOUND";
      const canDownload = dp.direction === "OUTBOUND";
      await pool.query(
        `INSERT INTO exchange.tenant_data_product_entitlements (tenant_id, data_product_id, can_upload, can_download, status)
         VALUES ($1, $2, $3, $4, 'ACTIVE')
         ON CONFLICT (tenant_id, data_product_id) DO UPDATE SET can_upload = EXCLUDED.can_upload, can_download = EXCLUDED.can_download`,
        [tenantId, dp.id, canUpload, canDownload],
      );
    }
  }

  logger.info(
    {
      organizations: [ORG_ID, ORG_B_ID],
      tenants: [TENANT_ID, TENANT_B_ID],
      users: [USER_ID, USER_B_ID],
      dataProducts: DATA_PRODUCTS.map((d) => d.id),
    },
    "Seed data loaded",
  );
  await pool.end();
}

main().catch((err) => {
  logger.error({ err }, "Seed failed");
  process.exit(1);
});
