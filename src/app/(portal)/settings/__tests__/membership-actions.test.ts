import { describe, expect, it, vi, beforeEach } from "vitest";

const {
  requireTenantContextMock,
  revalidatePathMock,
  listPendingRequestsMock,
  approveRequestMock,
  rejectRequestMock,
  getDefaultTenantMock,
  assignPortalUserToOrganizationMock,
} = vi.hoisted(() => ({
  requireTenantContextMock: vi.fn(),
  revalidatePathMock: vi.fn(),
  listPendingRequestsMock: vi.fn(),
  approveRequestMock: vi.fn(),
  rejectRequestMock: vi.fn(),
  getDefaultTenantMock: vi.fn(),
  assignPortalUserToOrganizationMock: vi.fn(),
}));

vi.mock("@/lib/tenant", () => ({ requireTenantContext: requireTenantContextMock }));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));
vi.mock("@/lib/user-directory", () => ({ assignPortalUserToOrganization: assignPortalUserToOrganizationMock }));
vi.mock("@/services", () => ({
  services: {
    organizationMemberships: {
      listPendingRequests: listPendingRequestsMock,
      approveRequest: approveRequestMock,
      rejectRequest: rejectRequestMock,
    },
    tenants: {
      getDefaultTenant: getDefaultTenantMock,
    },
  },
}));

import { approveMembershipRequest, rejectMembershipRequest } from "@/app/(portal)/settings/membership-actions";
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

describe("settings membership actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("approveMembershipRequest", () => {
    it("rejects (throws) when the caller isn't an org admin", async () => {
      requireTenantContextMock.mockResolvedValue(NON_ADMIN_TENANT);

      await expect(approveMembershipRequest("mreq-1")).rejects.toThrow(/admin/i);
      expect(approveRequestMock).not.toHaveBeenCalled();
    });

    it("no-ops for a request that isn't pending for the caller's org", async () => {
      requireTenantContextMock.mockResolvedValue(ADMIN_TENANT);
      listPendingRequestsMock.mockResolvedValue([]);

      await approveMembershipRequest("mreq-1");

      expect(assignPortalUserToOrganizationMock).not.toHaveBeenCalled();
      expect(approveRequestMock).not.toHaveBeenCalled();
    });

    it("assigns the requester to the org's default tenant as CUSTOMER_USER and marks the request approved", async () => {
      requireTenantContextMock.mockResolvedValue(ADMIN_TENANT);
      listPendingRequestsMock.mockResolvedValue([{ id: "mreq-1", userId: "user-2" }]);
      getDefaultTenantMock.mockResolvedValue({ id: "tenant-default" });

      await approveMembershipRequest("mreq-1");

      expect(assignPortalUserToOrganizationMock).toHaveBeenCalledWith("user-2", {
        organizationId: "org-1",
        tenantId: "tenant-default",
        role: UserRole.CUSTOMER_USER,
      });
      expect(approveRequestMock).toHaveBeenCalledWith("mreq-1", "admin-1");
      expect(revalidatePathMock).toHaveBeenCalledWith("/settings");
    });
  });

  describe("rejectMembershipRequest", () => {
    it("rejects (throws) when the caller isn't an org admin", async () => {
      requireTenantContextMock.mockResolvedValue(NON_ADMIN_TENANT);

      await expect(rejectMembershipRequest("mreq-1")).rejects.toThrow(/admin/i);
      expect(rejectRequestMock).not.toHaveBeenCalled();
    });

    it("marks a pending request rejected", async () => {
      requireTenantContextMock.mockResolvedValue(ADMIN_TENANT);
      listPendingRequestsMock.mockResolvedValue([{ id: "mreq-1", userId: "user-2" }]);

      await rejectMembershipRequest("mreq-1");

      expect(rejectRequestMock).toHaveBeenCalledWith("mreq-1", "admin-1");
      expect(revalidatePathMock).toHaveBeenCalledWith("/settings");
    });
  });
});
