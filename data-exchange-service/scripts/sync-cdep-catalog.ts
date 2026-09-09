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
// cdep now also pushes real-time, per-entity updates via
// `catalog-sync.routes.ts` right after each catalog-affecting write (see
// `src/lib/exchange-service/catalog-sync.ts` in cdep) — this script is the
// reconciliation backstop for whatever that push missed (the service was
// down, a push failed and was only logged, or rows created before this
// existed). Safe to run any time: `npm run sync:cdep`. See
// docs/exchange-service-integration.md § "Keeping catalogs in sync".
import { MongoClient } from "mongodb";
import { pool } from "../src/database/pool.js";
import { logger } from "../src/common/logger/logger.js";
import {
  upsertDataProduct,
  upsertEntitlement,
  upsertMembership,
  upsertOrganization,
  upsertTenant,
} from "../src/modules/catalog-sync/catalog-sync.repository.js";

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
  displayName: string;
  version: string;
}
interface CdepEntitlement {
  tenantId: string;
  dataProductId: string;
  status: string;
}
interface CdepDataProductDataset {
  dataProductId: string;
  datasetId: string;
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

  const [organizations, tenants, datasets, entitlements, users, dataProductDatasets] = await Promise.all([
    db.collection<CdepOrganization>("organizations").find({}).toArray(),
    db.collection<CdepTenant>("tenants").find({}).toArray(),
    db.collection<CdepDataset>("datasets").find({}).toArray(),
    db.collection<CdepEntitlement>("entitlements").find({ status: "ACTIVE" }).toArray(),
    db
      .collection<CdepUser>("users")
      .find({ organizationId: { $ne: null }, tenantId: { $ne: null }, role: { $in: ["CUSTOMER_ADMIN", "CUSTOMER_USER", "CUSTOMER_READONLY"] } })
      .toArray(),
    db.collection<CdepDataProductDataset>("dataProductDatasets").find({}).toArray(),
  ]);

  // cdep models the Dataset <-> DataProduct relationship as a many-to-many
  // join (a Dataset can sit under several DataProducts), not a field on
  // Dataset itself — see src/data/mocks/data-product-datasets.ts.
  const dataProductIdsByDataset = new Map<string, Set<string>>();
  for (const link of dataProductDatasets) {
    if (!dataProductIdsByDataset.has(link.datasetId)) dataProductIdsByDataset.set(link.datasetId, new Set());
    dataProductIdsByDataset.get(link.datasetId)!.add(link.dataProductId);
  }

  for (const org of organizations) {
    await upsertOrganization(org._id, org.displayName);
  }

  for (const tenant of tenants) {
    await upsertTenant(tenant._id, tenant.organizationId, tenant.displayName);
  }

  for (const user of users) {
    await upsertMembership(user._id, user.organizationId!, user.tenantId!, user.role!);
  }

  // Each cdep Dataset becomes a data-exchange-service data product in its
  // own right (this service has no separate DataProduct/Dataset tier —
  // see docs/exchange-service-integration.md "Catalog model mismatch").
  // Every one is BIDIRECTIONAL: cdep doesn't track upload-vs-download
  // intent per dataset, only per Exchange instance.
  for (const ds of datasets) {
    const parentDataProductIds = [...(dataProductIdsByDataset.get(ds._id) ?? [])];
    await upsertDataProduct(
      ds._id,
      ds.displayName,
      `Mirrors cdep dataset "${ds._id}" (catalog data product(s): ${parentDataProductIds.join(", ") || "none"}).`,
      ds.version ?? "unknown",
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
      const parentDataProductIds = dataProductIdsByDataset.get(ds._id) ?? new Set<string>();
      const entitled = [...parentDataProductIds].some((id) => entitledDataProducts.has(id));
      await upsertEntitlement(tenant._id, ds._id, entitled, entitled);
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
