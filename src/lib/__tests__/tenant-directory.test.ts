import { describe, expect, it, vi } from "vitest";
import { createFakeDb } from "@/test/fake-mongo";

const { getDbMock } = vi.hoisted(() => ({ getDbMock: vi.fn() }));

vi.mock("@/lib/mongodb", () => ({
  getDb: getDbMock,
}));

import {
  createTenant,
  findDefaultTenantForOrganization,
  findTenantById,
  listTenantsByOrganization,
  setDefaultTenant,
  setTenantStatus,
} from "@/lib/tenant-directory";

describe("tenant directory", () => {
  it("creates a default tenant for a brand-new organization", async () => {
    getDbMock.mockResolvedValue(createFakeDb({}));

    const tenant = await createTenant({ organizationId: "org-1", displayName: "Default", isDefault: true });

    expect(tenant.organizationId).toBe("org-1");
    expect(tenant.isDefault).toBe(true);
    expect(tenant.id).toMatch(/^tenant-default-[0-9a-f]{6}$/);

    const found = await findTenantById(tenant.id);
    expect(found?.id).toBe(tenant.id);
  });

  it("lists every tenant belonging to an organization, and no others", async () => {
    getDbMock.mockResolvedValue(createFakeDb({}));
    const org1Default = await createTenant({ organizationId: "org-1", displayName: "Default", isDefault: true });
    const org1Extra = await createTenant({ organizationId: "org-1", displayName: "EU", isDefault: false });
    await createTenant({ organizationId: "org-2", displayName: "Default", isDefault: true });

    const tenants = await listTenantsByOrganization("org-1");

    expect(tenants.map((t) => t.id).sort()).toEqual([org1Default.id, org1Extra.id].sort());
  });

  it("finds the default tenant for an organization", async () => {
    getDbMock.mockResolvedValue(createFakeDb({}));
    const defaultTenant = await createTenant({ organizationId: "org-1", displayName: "Default", isDefault: true });
    await createTenant({ organizationId: "org-1", displayName: "EU", isDefault: false });

    const found = await findDefaultTenantForOrganization("org-1");

    expect(found?.id).toBe(defaultTenant.id);
  });

  it("moves the default flag to a different tenant in the same organization", async () => {
    getDbMock.mockResolvedValue(createFakeDb({}));
    const original = await createTenant({ organizationId: "org-1", displayName: "Default", isDefault: true });
    const candidate = await createTenant({ organizationId: "org-1", displayName: "EU", isDefault: false });

    await setDefaultTenant("org-1", candidate.id);

    expect((await findTenantById(original.id))?.isDefault).toBe(false);
    expect((await findTenantById(candidate.id))?.isDefault).toBe(true);
    expect((await findDefaultTenantForOrganization("org-1"))?.id).toBe(candidate.id);
  });

  it("doesn't touch another organization's default when reassigning one org's default", async () => {
    getDbMock.mockResolvedValue(createFakeDb({}));
    await createTenant({ organizationId: "org-1", displayName: "Default", isDefault: true });
    const org1Candidate = await createTenant({ organizationId: "org-1", displayName: "EU", isDefault: false });
    const org2Default = await createTenant({ organizationId: "org-2", displayName: "Default", isDefault: true });

    await setDefaultTenant("org-1", org1Candidate.id);

    expect((await findDefaultTenantForOrganization("org-2"))?.id).toBe(org2Default.id);
  });

  it("activates/deactivates a tenant (Admin Console)", async () => {
    getDbMock.mockResolvedValue(createFakeDb({}));
    const tenant = await createTenant({ organizationId: "org-1", displayName: "Default", isDefault: true });

    await setTenantStatus(tenant.id, "inactive");
    expect((await findTenantById(tenant.id))?.status).toBe("inactive");

    await setTenantStatus(tenant.id, "active");
    expect((await findTenantById(tenant.id))?.status).toBe("active");
  });
});
