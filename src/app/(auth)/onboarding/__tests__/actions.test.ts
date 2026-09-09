import { describe, expect, it, vi, beforeEach } from "vitest";

const {
  authMock,
  redirectMock,
  searchOrganizationsByNameMock,
  createMembershipRequestMock,
  assignPortalUserToOrganizationMock,
  acceptInvitationRecordMock,
  declineInvitationRecordMock,
  findPendingInvitationByEmailMock,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  redirectMock: vi.fn(),
  searchOrganizationsByNameMock: vi.fn(),
  createMembershipRequestMock: vi.fn(),
  assignPortalUserToOrganizationMock: vi.fn(),
  acceptInvitationRecordMock: vi.fn(),
  declineInvitationRecordMock: vi.fn(),
  findPendingInvitationByEmailMock: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: authMock }));
vi.mock("next/navigation", () => ({ redirect: redirectMock }));
vi.mock("@/lib/organization-directory", () => ({
  searchOrganizationsByName: searchOrganizationsByNameMock,
}));
vi.mock("@/lib/organization-membership-directory", () => {
  class DuplicateMembershipRequestError extends Error {}
  return {
    DuplicateMembershipRequestError,
    createMembershipRequest: createMembershipRequestMock,
  };
});
vi.mock("@/lib/organization-invitation-directory", () => ({
  acceptInvitation: acceptInvitationRecordMock,
  declineInvitation: declineInvitationRecordMock,
  findPendingInvitationByEmail: findPendingInvitationByEmailMock,
}));
vi.mock("@/lib/user-directory", () => ({
  assignPortalUserToOrganization: assignPortalUserToOrganizationMock,
}));

import {
  acceptInvitation,
  declineInvitation,
  requestToJoinOrganization,
  searchOrganizations,
} from "@/app/(auth)/onboarding/actions";
import { DuplicateMembershipRequestError } from "@/lib/organization-membership-directory";
import { UserRole } from "@/models";

const SIGNED_IN_ORG_LESS = {
  user: { id: "user-1", name: "Ada", email: "ada@example.com", organizationId: null },
};
const SIGNED_IN_WITH_ORG = {
  user: { id: "user-1", name: "Ada", email: "ada@example.com", organizationId: "org-existing" },
};

describe("onboarding actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    redirectMock.mockImplementation(() => {
      throw new Error("REDIRECT");
    });
  });

  describe("searchOrganizations", () => {
    it("redirects to /login when signed out", async () => {
      authMock.mockResolvedValue(null);
      await expect(searchOrganizations("acme")).rejects.toThrow("REDIRECT");
      expect(redirectMock).toHaveBeenCalledWith("/login");
    });

    it("redirects to /dashboard for a user who already has an organization", async () => {
      authMock.mockResolvedValue(SIGNED_IN_WITH_ORG);
      await expect(searchOrganizations("acme")).rejects.toThrow("REDIRECT");
      expect(redirectMock).toHaveBeenCalledWith("/dashboard");
    });

    it("delegates to the directory search for an org-less signed-in user", async () => {
      authMock.mockResolvedValue(SIGNED_IN_ORG_LESS);
      searchOrganizationsByNameMock.mockResolvedValue([{ id: "org-1", displayName: "Acme" }]);

      const results = await searchOrganizations("acme");

      expect(results).toEqual([{ id: "org-1", displayName: "Acme" }]);
      expect(searchOrganizationsByNameMock).toHaveBeenCalledWith("acme");
    });
  });

  describe("requestToJoinOrganization", () => {
    it("creates the request and redirects to the pending page", async () => {
      authMock.mockResolvedValue(SIGNED_IN_ORG_LESS);
      createMembershipRequestMock.mockResolvedValue({ id: "mreq-1" });

      await expect(requestToJoinOrganization("org-1")).rejects.toThrow("REDIRECT");

      expect(createMembershipRequestMock).toHaveBeenCalledWith({
        organizationId: "org-1",
        userId: "user-1",
        userName: "Ada",
        userEmail: "ada@example.com",
      });
      expect(redirectMock).toHaveBeenCalledWith("/onboarding/pending");
    });

    it("still redirects to pending, without surfacing an error, on a duplicate request", async () => {
      authMock.mockResolvedValue(SIGNED_IN_ORG_LESS);
      createMembershipRequestMock.mockRejectedValue(new DuplicateMembershipRequestError("already pending"));

      await expect(requestToJoinOrganization("org-1")).rejects.toThrow("REDIRECT");
      expect(redirectMock).toHaveBeenCalledWith("/onboarding/pending");
    });

    it("re-throws an unexpected error instead of masking it", async () => {
      authMock.mockResolvedValue(SIGNED_IN_ORG_LESS);
      createMembershipRequestMock.mockRejectedValue(new Error("database is down"));

      await expect(requestToJoinOrganization("org-1")).rejects.toThrow("database is down");
      expect(redirectMock).not.toHaveBeenCalledWith("/onboarding/pending");
    });
  });

  describe("acceptInvitation", () => {
    it("redirects to /onboarding when there's no pending invitation for the caller's email", async () => {
      authMock.mockResolvedValue(SIGNED_IN_ORG_LESS);
      findPendingInvitationByEmailMock.mockResolvedValue(null);

      await expect(acceptInvitation()).rejects.toThrow("REDIRECT");

      expect(redirectMock).toHaveBeenCalledWith("/onboarding");
      expect(assignPortalUserToOrganizationMock).not.toHaveBeenCalled();
    });

    it("grants exactly the org/tenant/role the invitation specifies, matched by the caller's own email", async () => {
      authMock.mockResolvedValue(SIGNED_IN_ORG_LESS);
      findPendingInvitationByEmailMock.mockResolvedValue({
        id: "invite-1",
        organizationId: "org-1",
        tenantId: "tenant-1",
        role: UserRole.CUSTOMER_READONLY,
      });

      await expect(acceptInvitation()).rejects.toThrow("REDIRECT");

      expect(findPendingInvitationByEmailMock).toHaveBeenCalledWith("ada@example.com");
      expect(assignPortalUserToOrganizationMock).toHaveBeenCalledWith("user-1", {
        organizationId: "org-1",
        tenantId: "tenant-1",
        role: UserRole.CUSTOMER_READONLY,
      });
      expect(acceptInvitationRecordMock).toHaveBeenCalledWith("invite-1");
      expect(redirectMock).toHaveBeenCalledWith("/dashboard");
    });
  });

  describe("declineInvitation", () => {
    it("marks the invitation declined and redirects back to /onboarding", async () => {
      authMock.mockResolvedValue(SIGNED_IN_ORG_LESS);
      findPendingInvitationByEmailMock.mockResolvedValue({ id: "invite-1" });

      await expect(declineInvitation()).rejects.toThrow("REDIRECT");

      expect(declineInvitationRecordMock).toHaveBeenCalledWith("invite-1");
      expect(redirectMock).toHaveBeenCalledWith("/onboarding");
    });

    it("no-ops when there's no pending invitation for the caller's email", async () => {
      authMock.mockResolvedValue(SIGNED_IN_ORG_LESS);
      findPendingInvitationByEmailMock.mockResolvedValue(null);

      await expect(declineInvitation()).rejects.toThrow("REDIRECT");

      expect(declineInvitationRecordMock).not.toHaveBeenCalled();
    });
  });
});
