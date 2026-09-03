import { EntitlementStatus, type Entitlement } from "@/models";
import { DEFAULT_TENANT_ID, SECONDARY_TENANT_ID } from "./tenants";

/**
 * Seed fixtures for the `entitlements` collection (see
 * `scripts/seed-catalog.ts`) — the join between a Tenant and the Data
 * Products they may see. The two demo tenants are deliberately entitled
 * to different, only-partly-overlapping sets so that a bug granting the
 * full catalog to everyone would be visible immediately when testing
 * manually.
 */
export const MOCK_ENTITLEMENTS: Entitlement[] = [
  {
    id: "ent-acme-customer-insights",
    tenantId: DEFAULT_TENANT_ID,
    dataProductId: "dp-customer-insights",
    status: EntitlementStatus.ACTIVE,
    grantedAt: "2026-01-15T00:00:00Z",
    grantedBy: "platform-admin@dataexchange.example.com",
    expiresAt: null,
  },
  {
    id: "ent-acme-events-operations",
    tenantId: DEFAULT_TENANT_ID,
    dataProductId: "dp-events-operations",
    status: EntitlementStatus.ACTIVE,
    grantedAt: "2026-01-15T00:00:00Z",
    grantedBy: "platform-admin@dataexchange.example.com",
    expiresAt: null,
  },
  {
    id: "ent-acme-commerce-finance",
    tenantId: DEFAULT_TENANT_ID,
    dataProductId: "dp-commerce-finance",
    status: EntitlementStatus.ACTIVE,
    grantedAt: "2026-01-15T00:00:00Z",
    grantedBy: "platform-admin@dataexchange.example.com",
    expiresAt: null,
  },
  {
    id: "ent-globex-events-operations",
    tenantId: SECONDARY_TENANT_ID,
    dataProductId: "dp-events-operations",
    status: EntitlementStatus.ACTIVE,
    grantedAt: "2026-03-01T00:00:00Z",
    grantedBy: "platform-admin@dataexchange.example.com",
    expiresAt: null,
  },
];
