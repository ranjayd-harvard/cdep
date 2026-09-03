import { describe, expect, it, vi, beforeEach } from "vitest";

const {
  requireTenantContextMock,
  revalidatePathMock,
  listPortalUsersByOrganizationMock,
  updateUserTenantMock,
  listTenantsMock,
} = vi.hoisted(() => ({
  requireTenantContextMock: vi.fn(),
  revalidatePathMock: vi.fn(),
  listPortalUsersByOrganizationMock: vi.fn(),
  updateUserTenantMock: vi.fn(),
  listTenantsMock: vi.fn(),
}));

vi.mock("@/lib/tenant", () => ({ requireTenantContext: requireTenantContextMock }));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));
vi.mock("@/lib/user-directory", () => ({
  listPortalUsersByOrganization: listPortalUsersByOrganizationMock,
  updateUserTenant: updateUserTenantMock,
}));
vi.mock("@/services", () => ({
  services: {
    tenants: {
      listTenants: listTenantsMock,
    },
  },
}));

import { reassignMemberTenant } from "@/app/(portal)/settings/member-actions";
import { UserRole } from "@/models";

const ADMIN_TENANT = {
  userId: "admin-1",
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

describe("reassignMemberTenant", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects (throws) when the caller isn't an org admin", async () => {
    requireTenantContextMock.mockResolvedValue(NON_ADMIN_TENANT);

    await expect(reassignMemberTenant("user-2", makeFormData({ tenantId: "tenant-eu" }))).rejects.toThrow(/admin/i);
    expect(updateUserTenantMock).not.toHaveBeenCalled();
  });

  it("no-ops for a member who isn't in the caller's org", async () => {
    requireTenantContextMock.mockResolvedValue(ADMIN_TENANT);
    listPortalUsersByOrganizationMock.mockResolvedValue([{ id: "user-2", tenantId: "tenant-default" }]);
    listTenantsMock.mockResolvedValue([{ id: "tenant-eu" }]);

    await reassignMemberTenant("user-from-another-org", makeFormData({ tenantId: "tenant-eu" }));

    expect(updateUserTenantMock).not.toHaveBeenCalled();
  });

  it("no-ops for a tenant id that isn't in the caller's org", async () => {
    requireTenantContextMock.mockResolvedValue(ADMIN_TENANT);
    listPortalUsersByOrganizationMock.mockResolvedValue([{ id: "user-2", tenantId: "tenant-default" }]);
    listTenantsMock.mockResolvedValue([{ id: "tenant-default" }]);

    await reassignMemberTenant("user-2", makeFormData({ tenantId: "tenant-from-another-org" }));

    expect(updateUserTenantMock).not.toHaveBeenCalled();
  });

  it("no-ops when the member is already on that tenant", async () => {
    requireTenantContextMock.mockResolvedValue(ADMIN_TENANT);
    listPortalUsersByOrganizationMock.mockResolvedValue([{ id: "user-2", tenantId: "tenant-eu" }]);
    listTenantsMock.mockResolvedValue([{ id: "tenant-default" }, { id: "tenant-eu" }]);

    await reassignMemberTenant("user-2", makeFormData({ tenantId: "tenant-eu" }));

    expect(updateUserTenantMock).not.toHaveBeenCalled();
  });

  it("moves a member to a different tenant in the same org", async () => {
    requireTenantContextMock.mockResolvedValue(ADMIN_TENANT);
    listPortalUsersByOrganizationMock.mockResolvedValue([{ id: "user-2", tenantId: "tenant-default" }]);
    listTenantsMock.mockResolvedValue([{ id: "tenant-default" }, { id: "tenant-eu" }]);

    await reassignMemberTenant("user-2", makeFormData({ tenantId: "tenant-eu" }));

    expect(updateUserTenantMock).toHaveBeenCalledWith("user-2", "tenant-eu");
    expect(revalidatePathMock).toHaveBeenCalledWith("/settings");
  });
});
