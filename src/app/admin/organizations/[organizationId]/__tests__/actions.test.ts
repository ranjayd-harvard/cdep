import { describe, expect, it, vi, beforeEach } from "vitest";

const {
  requireSuperuserContextMock,
  revalidatePathMock,
  listPendingRequestsMock,
  approveRequestMock,
  rejectRequestMock,
  getDefaultTenantMock,
  assignPortalUserToOrganizationMock,
} = vi.hoisted(() => ({
  requireSuperuserContextMock: vi.fn(),
  revalidatePathMock: vi.fn(),
  listPendingRequestsMock: vi.fn(),
  approveRequestMock: vi.fn(),
  rejectRequestMock: vi.fn(),
  getDefaultTenantMock: vi.fn(),
  assignPortalUserToOrganizationMock: vi.fn(),
}));

vi.mock("@/lib/admin", () => ({ requireSuperuserContext: requireSuperuserContextMock }));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));
vi.mock("@/lib/user-directory", () => ({
  assignPortalUserToOrganization: assignPortalUserToOrganizationMock,
  findPortalUserById: vi.fn(),
  setPortalUserRole: vi.fn(),
  setPortalUserStatus: vi.fn(),
  verifyPortalUserEmail: vi.fn(),
}));
vi.mock("@/lib/auth-tokens", () => ({ createAuthToken: vi.fn() }));
vi.mock("@/lib/auth-emails", () => ({ sendAccountValidatedEmail: vi.fn() }));
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
    organizations: { getOrganization: vi.fn() },
    entitlements: {},
    organizationInvitations: {},
  },
}));

import { approveMembershipRequest, rejectMembershipRequest } from "@/app/admin/organizations/[organizationId]/actions";
import { UserRole } from "@/models";

const SUPERUSER = { userId: "superuser-1", name: "Super CDEP", email: "super@example.com" };

describe("admin console organization membership actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireSuperuserContextMock.mockResolvedValue(SUPERUSER);
  });

  describe("approveMembershipRequest", () => {
    it("no-ops for a request that isn't pending for this org", async () => {
      listPendingRequestsMock.mockResolvedValue([]);

      await approveMembershipRequest("org-1", "mreq-1");

      expect(assignPortalUserToOrganizationMock).not.toHaveBeenCalled();
      expect(approveRequestMock).not.toHaveBeenCalled();
    });

    it("throws if the org has no default tenant", async () => {
      listPendingRequestsMock.mockResolvedValue([{ id: "mreq-1", userId: "user-2" }]);
      getDefaultTenantMock.mockResolvedValue(null);

      await expect(approveMembershipRequest("org-1", "mreq-1")).rejects.toThrow(/default tenant/i);
      expect(assignPortalUserToOrganizationMock).not.toHaveBeenCalled();
      expect(approveRequestMock).not.toHaveBeenCalled();
    });

    it("assigns the requester to the org's default tenant as CUSTOMER_USER and marks the request approved", async () => {
      listPendingRequestsMock.mockResolvedValue([{ id: "mreq-1", userId: "user-2" }]);
      getDefaultTenantMock.mockResolvedValue({ id: "tenant-default" });

      await approveMembershipRequest("org-1", "mreq-1");

      expect(assignPortalUserToOrganizationMock).toHaveBeenCalledWith("user-2", {
        organizationId: "org-1",
        tenantId: "tenant-default",
        role: UserRole.CUSTOMER_USER,
      });
      expect(approveRequestMock).toHaveBeenCalledWith("mreq-1", "superuser-1");
      expect(revalidatePathMock).toHaveBeenCalledWith("/admin/organizations/org-1");
    });
  });

  describe("rejectMembershipRequest", () => {
    it("marks a request rejected", async () => {
      await rejectMembershipRequest("org-1", "mreq-1");

      expect(rejectRequestMock).toHaveBeenCalledWith("mreq-1", "superuser-1");
      expect(revalidatePathMock).toHaveBeenCalledWith("/admin/organizations/org-1");
    });
  });
});
