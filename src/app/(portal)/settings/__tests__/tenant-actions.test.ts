import { describe, expect, it, vi, beforeEach } from "vitest";

const { requireTenantContextMock, revalidatePathMock, listTenantsMock, setDefaultTenantMock, updateUserTenantMock } =
  vi.hoisted(() => ({
    requireTenantContextMock: vi.fn(),
    revalidatePathMock: vi.fn(),
    listTenantsMock: vi.fn(),
    setDefaultTenantMock: vi.fn(),
    updateUserTenantMock: vi.fn(),
  }));

vi.mock("@/lib/tenant", () => ({ requireTenantContext: requireTenantContextMock }));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));
vi.mock("@/lib/user-directory", () => ({ updateUserTenant: updateUserTenantMock }));
vi.mock("@/services", () => ({
  services: {
    tenants: {
      listTenants: listTenantsMock,
      setDefaultTenant: setDefaultTenantMock,
    },
  },
}));

import { setDefaultTenant, switchMyTenant } from "@/app/(portal)/settings/tenant-actions";
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

describe("settings tenant actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("setDefaultTenant", () => {
    it("rejects (throws) when the caller isn't an org admin", async () => {
      requireTenantContextMock.mockResolvedValue(NON_ADMIN_TENANT);

      await expect(setDefaultTenant("tenant-eu")).rejects.toThrow(/admin/i);
      expect(setDefaultTenantMock).not.toHaveBeenCalled();
    });

    it("no-ops for a tenant id that doesn't belong to the caller's org", async () => {
      requireTenantContextMock.mockResolvedValue(ADMIN_TENANT);
      listTenantsMock.mockResolvedValue([{ id: "tenant-default" }]);

      await setDefaultTenant("tenant-from-another-org");

      expect(setDefaultTenantMock).not.toHaveBeenCalled();
    });

    it("moves the org's default tenant and revalidates settings", async () => {
      requireTenantContextMock.mockResolvedValue(ADMIN_TENANT);
      listTenantsMock.mockResolvedValue([{ id: "tenant-default" }, { id: "tenant-eu" }]);

      await setDefaultTenant("tenant-eu");

      expect(setDefaultTenantMock).toHaveBeenCalledWith("org-1", "tenant-eu");
      expect(revalidatePathMock).toHaveBeenCalledWith("/settings");
    });
  });

  describe("switchMyTenant", () => {
    it("is available to a non-admin (any org member can switch their own tenant)", async () => {
      requireTenantContextMock.mockResolvedValue(NON_ADMIN_TENANT);
      listTenantsMock.mockResolvedValue([{ id: "tenant-default" }, { id: "tenant-eu" }]);

      await switchMyTenant(makeFormData({ tenantId: "tenant-eu" }));

      expect(updateUserTenantMock).toHaveBeenCalledWith("user-1", "tenant-eu");
      expect(revalidatePathMock).toHaveBeenCalledWith("/settings");
    });

    it("no-ops when switching to the tenant already active", async () => {
      requireTenantContextMock.mockResolvedValue(ADMIN_TENANT);

      await switchMyTenant(makeFormData({ tenantId: "tenant-default" }));

      expect(updateUserTenantMock).not.toHaveBeenCalled();
    });

    it("no-ops for a tenant id that doesn't belong to the caller's org", async () => {
      requireTenantContextMock.mockResolvedValue(ADMIN_TENANT);
      listTenantsMock.mockResolvedValue([{ id: "tenant-default" }]);

      await switchMyTenant(makeFormData({ tenantId: "tenant-from-another-org" }));

      expect(updateUserTenantMock).not.toHaveBeenCalled();
    });
  });
});
