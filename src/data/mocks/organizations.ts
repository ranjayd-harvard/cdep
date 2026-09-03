import type { Organization } from "@/models";

/**
 * Seed fixtures for the `organizations` collection (see
 * `scripts/seed-catalog.ts`). Two organizations are seeded, not one, so
 * that cross-tenant isolation is something you can actually exercise end
 * to end — sign in as each and confirm neither sees the other's Data
 * Products — rather than a property that only holds because there's
 * nothing to leak. Each gets exactly one default Tenant (see
 * `src/data/mocks/tenants.ts`), which is what data is actually scoped by.
 */
export const MOCK_ORGANIZATIONS: Organization[] = [
  {
    id: "org-acme-live-001",
    name: "acme-live-entertainment",
    displayName: "Acme Live Entertainment",
    status: "active",
  },
  {
    id: "org-globex-events-002",
    name: "globex-events",
    displayName: "Globex Events",
    status: "active",
  },
];

export const DEFAULT_ORGANIZATION_ID = MOCK_ORGANIZATIONS[0].id;
export const SECONDARY_ORGANIZATION_ID = MOCK_ORGANIZATIONS[1].id;
