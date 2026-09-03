import { describe, expect, it, vi, beforeEach } from "vitest";

const {
  requireTenantContextMock,
  revalidatePathMock,
  listTenantsMock,
  getEntitlementsMock,
  grantEntitlementMock,
  revokeEntitlementMock,
  reactivateEntitlementMock,
} = vi.hoisted(() => ({
  requireTenantContextMock: vi.fn(),
  revalidatePathMock: vi.fn(),
  listTenantsMock: vi.fn(),
  getEntitlementsMock: vi.fn(),
  grantEntitlementMock: vi.fn(),
  revokeEntitlementMock: vi.fn(),
  reactivateEntitlementMock: vi.fn(),
}));

vi.mock("@/lib/tenant", () => ({ requireTenantContext: requireTenantContextMock }));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));
vi.mock("@/services", () => ({
  services: {
    tenants: {
      listTenants: listTenantsMock,
    },
    entitlements: {
      getEntitlements: getEntitlementsMock,
      grantEntitlement: grantEntitlementMock,
      revokeEntitlement: revokeEntitlementMock,
      reactivateEntitlement: reactivateEntitlementMock,
    },
  },
}));

import { grantEntitlement, reactivateEntitlement, revokeEntitlement } from "@/app/(portal)/entitlements/entitlement-actions";
import { UserRole } from "@/models";

const ADMIN_TENANT = {
  userId: "user-1",
  organizationId: "org-1",
  tenantId: "tenant-default",
  role: UserRole.CUSTOMER_ADMIN,
  name: "Admin",
  email: "admin@example.com",
};
const NON_ADMIN_TENANT = { ...ADMIN_TENANT, role: UserRole.CUSTOMER_USER };

function makeFormData(fields: Record<string, string>) {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    formData.set(key, value);
  }
  return formData;
}

describe("entitlement actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("grantEntitlement", () => {
    it("rejects when the caller isn't an org admin", async () => {
      requireTenantContextMock.mockResolvedValue(NON_ADMIN_TENANT);

      const result = await grantEntitlement("tenant-default", {}, makeFormData({ dataProductId: "dp-1" }));

      expect(result.error).toMatch(/admin/i);
      expect(grantEntitlementMock).not.toHaveBeenCalled();
    });

    it("rejects a tenant id that doesn't belong to the caller's org", async () => {
      requireTenantContextMock.mockResolvedValue(ADMIN_TENANT);
      listTenantsMock.mockResolvedValue([{ id: "tenant-default" }]);

      const result = await grantEntitlement(
        "tenant-from-another-org",
        {},
        makeFormData({ dataProductId: "dp-1" }),
      );

      expect(result.error).toBeTruthy();
      expect(grantEntitlementMock).not.toHaveBeenCalled();
    });

    it("rejects a missing data product", async () => {
      requireTenantContextMock.mockResolvedValue(ADMIN_TENANT);
      listTenantsMock.mockResolvedValue([{ id: "tenant-default" }]);

      const result = await grantEntitlement("tenant-default", {}, makeFormData({}));

      expect(result.error).toBeTruthy();
      expect(grantEntitlementMock).not.toHaveBeenCalled();
    });

    it("grants and revalidates on the happy path", async () => {
      requireTenantContextMock.mockResolvedValue(ADMIN_TENANT);
      listTenantsMock.mockResolvedValue([{ id: "tenant-default" }]);

      const result = await grantEntitlement("tenant-default", {}, makeFormData({ dataProductId: "dp-1" }));

      expect(grantEntitlementMock).toHaveBeenCalledWith("tenant-default", "dp-1", "admin@example.com");
      expect(revalidatePathMock).toHaveBeenCalledWith("/entitlements");
      expect(result.success).toBeTruthy();
    });
  });

  describe("revokeEntitlement", () => {
    it("throws when the caller isn't an org admin", async () => {
      requireTenantContextMock.mockResolvedValue(NON_ADMIN_TENANT);

      await expect(revokeEntitlement("tenant-default", "ent-1")).rejects.toThrow(/admin/i);
      expect(revokeEntitlementMock).not.toHaveBeenCalled();
    });

    it("no-ops for an entitlement that doesn't belong to the tenant", async () => {
      requireTenantContextMock.mockResolvedValue(ADMIN_TENANT);
      listTenantsMock.mockResolvedValue([{ id: "tenant-default" }]);
      getEntitlementsMock.mockResolvedValue([{ id: "ent-other" }]);

      await revokeEntitlement("tenant-default", "ent-1");

      expect(revokeEntitlementMock).not.toHaveBeenCalled();
    });

    it("revokes and revalidates on the happy path", async () => {
      requireTenantContextMock.mockResolvedValue(ADMIN_TENANT);
      listTenantsMock.mockResolvedValue([{ id: "tenant-default" }]);
      getEntitlementsMock.mockResolvedValue([{ id: "ent-1" }]);

      await revokeEntitlement("tenant-default", "ent-1");

      expect(revokeEntitlementMock).toHaveBeenCalledWith("tenant-default", "ent-1");
      expect(revalidatePathMock).toHaveBeenCalledWith("/entitlements");
    });
  });

  describe("reactivateEntitlement", () => {
    it("reactivates and revalidates on the happy path", async () => {
      requireTenantContextMock.mockResolvedValue(ADMIN_TENANT);
      listTenantsMock.mockResolvedValue([{ id: "tenant-default" }]);
      getEntitlementsMock.mockResolvedValue([{ id: "ent-1" }]);

      await reactivateEntitlement("tenant-default", "ent-1");

      expect(reactivateEntitlementMock).toHaveBeenCalledWith("tenant-default", "ent-1");
      expect(revalidatePathMock).toHaveBeenCalledWith("/entitlements");
    });
  });
});
