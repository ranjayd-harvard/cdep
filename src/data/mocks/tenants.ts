import type { Tenant } from "@/models";
import { DEFAULT_ORGANIZATION_ID, SECONDARY_ORGANIZATION_ID } from "./organizations";

/**
 * Seed fixtures for the `tenants` collection (see
 * `scripts/seed-catalog.ts`) — the actual data-scoping unit (see
 * `src/lib/tenant-scoped-collection.ts`). Every organization gets exactly
 * one `isDefault: true` tenant here, matching what
 * `createOrganizationAndBecomeAdmin` (see
 * `src/app/(auth)/onboarding/actions.ts`) produces for a real signup.
 */
export const MOCK_TENANTS: Tenant[] = [
  {
    id: "tenant-acme-live-default-001",
    organizationId: DEFAULT_ORGANIZATION_ID,
    name: "default",
    displayName: "Default",
    isDefault: true,
    status: "active",
  },
  {
    id: "tenant-globex-events-default-002",
    organizationId: SECONDARY_ORGANIZATION_ID,
    name: "default",
    displayName: "Default",
    isDefault: true,
    status: "active",
  },
];

export const DEFAULT_TENANT_ID = MOCK_TENANTS[0].id;
export const SECONDARY_TENANT_ID = MOCK_TENANTS[1].id;
