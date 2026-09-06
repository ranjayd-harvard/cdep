// Mirrors cdep's ACTUAL, LIVE MongoDB catalog (organizations, tenants,
// datasets, entitlements) into this service's control-plane database —
// replacing the old scripts/seed-cdep.ts, which hardcoded a point-in-time
// snapshot of cdep's *mock* catalog only.
//
// Why the snapshot approach broke: cdep's real onboarding flow lets a
// user create a brand-new organization/tenant and grant it entitlements
// at any time, entirely independent of the two seeded mock orgs
// (org-acme-live-001/org-globex-events-002). A hardcoded snapshot only
// ever knew about those two — every other org (including ones created by
// hand while testing, e.g. "org-vobis-org-722aea" / "Vobis Org") got
// ENTITLEMENT_DENIED on every upload/download, because this service had
// simply never heard of it. cdep's `organizations`/`tenants`/`datasets`/
// `entitlements` Mongo collections don't distinguish mock-seeded rows
// from real ones at read time (both go through `scripts/seed-catalog.ts`
// or the real onboarding/entitlement-granting UI into the exact same
// collections) — so reading them live, instead of copying a snapshot by
// hand, is both simpler and correct by construction: whatever cdep
// actually knows about, this service now knows about too, every time
// this script runs.
//
// This is the ONLY place in this service that talks to MongoDB — see
// AGENTS.md's "Do NOT use MongoDB" for why that's true of the *service
// itself* (its own control-plane persistence is PostgreSQL, full stop).
// This script is a one-off, ops-triggered catalog bridge — read cdep's
// database, write ours, exit — not part of the running service, and not
// imported by anything under src/.
//
// Run manually after any cdep catalog change you want reflected here
// (new signup, new entitlement grant, catalog edit): `npm run sync:cdep`.
// See docs/exchange-service-integration.md § "Keeping catalogs in sync"
// for the fuller picture and the longer-term fix (a real-time sync
// instead of an on-demand script).
import { MongoClient } from "mongodb";
import { pool } from "../src/database/pool.js";
import { logger } from "../src/common/logger/logger.js";

const CDEP_MONGODB_URI = process.env.CDEP_MONGODB_URI;
const CDEP_MONGODB_DATABASE = process.env.CDEP_MONGODB_DATABASE ?? "portal";

if (!CDEP_MONGODB_URI) {
  logger.error(
    "CDEP_MONGODB_URI is not set. Point it at cdep's MongoDB, e.g.:\n" +
      '  CDEP_MONGODB_URI="mongodb://<user>:<pass>@localhost:27025/portal?authSource=admin" npm run sync:cdep\n' +
      "(matches cdep's own MONGODB_URI — see cdep/.env).",
  );
  process.exit(1);
}

interface CdepOrganization {
  _id: string;
  displayName: string;
}
interface CdepTenant {
  _id: string;
  organizationId: string;
  displayName: string;
}
interface CdepDataset {
  _id: string;
  dataProductId: string;
  displayName: string;
  version: string;
}
interface CdepEntitlement {
  tenantId: string;
  dataProductId: string;
  status: string;
}
interface CdepUser {
  _id: string;
  organizationId: string | null;
  tenantId: string | null;
  role: string | null;
}

async function main() {
  const client = new MongoClient(CDEP_MONGODB_URI!);
  await client.connect();
  const db = client.db(CDEP_MONGODB_DATABASE);

  const [organizations, tenants, datasets, entitlements, users] = await Promise.all([
    db.collection<CdepOrganization>("organizations").find({}).toArray(),
    db.collection<CdepTenant>("tenants").find({}).toArray(),
    db.collection<CdepDataset>("datasets").find({}).toArray(),
    db.collection<CdepEntitlement>("entitlements").find({ status: "ACTIVE" }).toArray(),
    db
      .collection<CdepUser>("users")
      .find({ organizationId: { $ne: null }, tenantId: { $ne: null }, role: { $in: ["CUSTOMER_ADMIN", "CUSTOMER_USER", "CUSTOMER_READONLY"] } })
      .toArray(),
  ]);

  for (const org of organizations) {
    await pool.query(
      `INSERT INTO exchange.organizations (organization_id, display_name, status)
       VALUES ($1, $2, 'ACTIVE')
       ON CONFLICT (organization_id) DO UPDATE SET display_name = EXCLUDED.display_name`,
      [org._id, org.displayName],
    );
  }

  for (const tenant of tenants) {
    await pool.query(
      `INSERT INTO exchange.tenants (tenant_id, organization_id, display_name, status)
       VALUES ($1, $2, $3, 'ACTIVE')
       ON CONFLICT (tenant_id) DO UPDATE SET organization_id = EXCLUDED.organization_id, display_name = EXCLUDED.display_name`,
      [tenant._id, tenant.organizationId, tenant.displayName],
    );
  }

  for (const user of users) {
    await pool.query(
      `INSERT INTO exchange.tenant_memberships (user_id, organization_id, tenant_id, role, status)
       VALUES ($1, $2, $3, $4, 'ACTIVE')
       ON CONFLICT (user_id, organization_id, tenant_id) DO UPDATE SET role = EXCLUDED.role`,
      [user._id, user.organizationId, user.tenantId, user.role],
    );
  }

  // Each cdep Dataset becomes a data-exchange-service data product in its
  // own right (this service has no separate DataProduct/Dataset tier —
  // see docs/exchange-service-integration.md "Catalog model mismatch").
  // Every one is BIDIRECTIONAL: cdep doesn't track upload-vs-download
  // intent per dataset, only per Exchange instance.
  for (const ds of datasets) {
    await pool.query(
      `INSERT INTO exchange.data_products (data_product_id, name, description, direction, current_schema_version, status)
       VALUES ($1, $2, $3, 'BIDIRECTIONAL', $4, 'ACTIVE')
       ON CONFLICT (data_product_id) DO UPDATE SET
         name = EXCLUDED.name, current_schema_version = EXCLUDED.current_schema_version`,
      [ds._id, ds.displayName, `Mirrors cdep dataset "${ds._id}" (catalog data product ${ds.dataProductId}).`, ds.version ?? "unknown"],
    );
  }

  // entitlements are granted at the DataProduct level in cdep; expand to
  // every Dataset under that DataProduct, since that's the granularity
  // data-exchange-service authorizes uploads/downloads at.
  const entitledDataProductsByTenant = new Map<string, Set<string>>();
  for (const ent of entitlements) {
    if (!entitledDataProductsByTenant.has(ent.tenantId)) entitledDataProductsByTenant.set(ent.tenantId, new Set());
    entitledDataProductsByTenant.get(ent.tenantId)!.add(ent.dataProductId);
  }

  for (const tenant of tenants) {
    const entitledDataProducts = entitledDataProductsByTenant.get(tenant._id) ?? new Set<string>();
    for (const ds of datasets) {
      const entitled = entitledDataProducts.has(ds.dataProductId);
      await pool.query(
        `INSERT INTO exchange.tenant_data_product_entitlements (tenant_id, data_product_id, can_upload, can_download, status)
         VALUES ($1, $2, $3, $3, 'ACTIVE')
         ON CONFLICT (tenant_id, data_product_id) DO UPDATE SET
           can_upload = EXCLUDED.can_upload, can_download = EXCLUDED.can_download`,
        [tenant._id, ds._id, entitled],
      );
    }
  }

  logger.info(
    {
      organizations: organizations.map((o) => o._id),
      tenants: tenants.map((t) => t._id),
      datasets: datasets.map((d) => d._id),
      entitlementGrants: entitlements.length,
    },
    "Synced cdep catalog into data-exchange-service",
  );

  await client.close();
  await pool.end();
}

main().catch((err) => {
  logger.error({ err }, "sync-cdep-catalog failed");
  process.exit(1);
});
