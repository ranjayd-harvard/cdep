import { describe, expect, it, vi } from "vitest";
import { createFakeDb } from "@/test/fake-mongo";

const { getDbMock } = vi.hoisted(() => ({ getDbMock: vi.fn() }));

vi.mock("@/lib/mongodb", () => ({
  getDb: getDbMock,
}));

import { MongoTenantService } from "@/services/mongo/mongo-tenant-service";

describe("MongoTenantService", () => {
  it("creates a non-default tenant and lists it under its organization", async () => {
    getDbMock.mockResolvedValue(createFakeDb({}));
    const service = new MongoTenantService();

    const tenant = await service.createTenant("org-1", "EU Workspace");

    expect(tenant.isDefault).toBe(false);
    expect(await service.getTenant(tenant.id)).toMatchObject({ id: tenant.id });
    expect((await service.listTenants("org-1")).map((t) => t.id)).toContain(tenant.id);
  });

  it("has no default tenant for an organization until one is seeded", async () => {
    getDbMock.mockResolvedValue(createFakeDb({}));
    const service = new MongoTenantService();

    expect(await service.getDefaultTenant("org-1")).toBeNull();
  });

  it("reassigns the organization's default tenant", async () => {
    getDbMock.mockResolvedValue(createFakeDb({}));
    const service = new MongoTenantService();
    const candidate = await service.createTenant("org-1", "EU Workspace");

    await service.setDefaultTenant("org-1", candidate.id);

    expect((await service.getDefaultTenant("org-1"))?.id).toBe(candidate.id);
  });
});
