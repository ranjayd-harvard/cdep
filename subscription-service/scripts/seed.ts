// Deterministic local demo fixture (spec §59): grants Vobis Org / Default
// Tenant ALLOW access to Event Performance. Assumes data-product-catalog-
// service is already running and seeded with "event-performance" (its own
// `npm run seed`) — this script does not create catalog data.
import { pool } from "../src/database/pool.js";
import { resolveMigrationsDir, runMigrations } from "../src/database/migrations.js";
import { grantEntitlement } from "../src/application/services/entitlement.service.js";
import { logger } from "../src/common/logger/logger.js";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ORGANIZATION_ID = "org-vobis-org-722aea";
const TENANT_ID = "tenant-default-47d849";
const DATA_PRODUCT_ID = "event-performance";

async function main() {
  await runMigrations(pool, resolveMigrationsDir(__dirname));

  const entitlement = await grantEntitlement(
    {
      organizationId: ORGANIZATION_ID,
      tenantId: TENANT_ID,
      dataProductId: DATA_PRODUCT_ID,
      effect: "ALLOW",
      validFrom: null,
      validUntil: null,
      reason: "Seed fixture — Vobis Org / Default Tenant demo scenario",
    },
    { actorType: "SYSTEM", actorId: "seed-script" },
  );

  logger.info(
    { entitlementId: entitlement.entitlementId, organizationId: ORGANIZATION_ID, tenantId: TENANT_ID, dataProductId: DATA_PRODUCT_ID },
    "Seeded Vobis Org / Default Tenant entitlement for Event Performance",
  );

  await pool.end();
}

main().catch((err) => {
  logger.error({ err }, "Seed failed");
  process.exit(1);
});
