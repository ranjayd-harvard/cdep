import { describe, expect, it, vi, beforeEach } from "vitest";

const {
  requireTenantContextMock,
  revalidatePathMock,
  findPortalUserByEmailMock,
  createAuthTokenMock,
  sendOrganizationInviteEmailMock,
  listTenantsMock,
  inviteToOrganizationMock,
  listPendingInvitationsMock,
  revokeInvitationMock,
  getOrganizationMock,
} = vi.hoisted(() => ({
  requireTenantContextMock: vi.fn(),
  revalidatePathMock: vi.fn(),
  findPortalUserByEmailMock: vi.fn(),
  createAuthTokenMock: vi.fn(),
  sendOrganizationInviteEmailMock: vi.fn(),
  listTenantsMock: vi.fn(),
  inviteToOrganizationMock: vi.fn(),
  listPendingInvitationsMock: vi.fn(),
  revokeInvitationMock: vi.fn(),
  getOrganizationMock: vi.fn(),
}));

vi.mock("@/lib/tenant", () => ({ requireTenantContext: requireTenantContextMock }));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));
vi.mock("@/lib/user-directory", () => ({ findPortalUserByEmail: findPortalUserByEmailMock }));
vi.mock("@/lib/auth-tokens", () => ({ createAuthToken: createAuthTokenMock }));
vi.mock("@/lib/auth-emails", () => ({ sendOrganizationInviteEmail: sendOrganizationInviteEmailMock }));
vi.mock("@/lib/organization-invitation-directory", () => {
  class DuplicateInvitationError extends Error {}
  return { DuplicateInvitationError };
});
vi.mock("@/services", () => ({
  services: {
    tenants: { listTenants: listTenantsMock },
    organizations: { getOrganization: getOrganizationMock },
    organizationInvitations: {
      inviteToOrganization: inviteToOrganizationMock,
      listPendingInvitations: listPendingInvitationsMock,
      revokeInvitation: revokeInvitationMock,
    },
  },
}));

import { inviteMember, revokeInvitation } from "@/app/(portal)/settings/invitation-actions";
import { DuplicateInvitationError } from "@/lib/organization-invitation-directory";
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

describe("inviteMember", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listTenantsMock.mockResolvedValue([{ id: "tenant-default", isDefault: true }]);
    getOrganizationMock.mockResolvedValue({ id: "org-1", displayName: "Acme" });
    createAuthTokenMock.mockResolvedValue("raw-token");
  });

  it("returns an error for a non-admin without inviting anyone", async () => {
    requireTenantContextMock.mockResolvedValue(NON_ADMIN_TENANT);

    const result = await inviteMember({}, makeFormData({ email: "new@example.com", role: UserRole.CUSTOMER_USER }));

    expect(result.error).toBeTruthy();
    expect(inviteToOrganizationMock).not.toHaveBeenCalled();
  });

  it("rejects an invalid email", async () => {
    requireTenantContextMock.mockResolvedValue(ADMIN_TENANT);

    const result = await inviteMember({}, makeFormData({ email: "not-an-email", role: UserRole.CUSTOMER_USER }));

    expect(result.error).toBeTruthy();
    expect(inviteToOrganizationMock).not.toHaveBeenCalled();
  });

  it("rejects an invalid role", async () => {
    requireTenantContextMock.mockResolvedValue(ADMIN_TENANT);

    const result = await inviteMember({}, makeFormData({ email: "new@example.com", role: "NOT_A_ROLE" }));

    expect(result.error).toBeTruthy();
    expect(inviteToOrganizationMock).not.toHaveBeenCalled();
  });

  it("refuses to invite an email that already belongs to an organization", async () => {
    requireTenantContextMock.mockResolvedValue(ADMIN_TENANT);
    findPortalUserByEmailMock.mockResolvedValue({ id: "user-2", organizationId: "org-other" });

    const result = await inviteMember({}, makeFormData({ email: "taken@example.com", role: UserRole.CUSTOMER_USER }));

    expect(result.error).toMatch(/already belongs/i);
    expect(inviteToOrganizationMock).not.toHaveBeenCalled();
  });

  it("defaults to the org's default tenant when none is specified", async () => {
    requireTenantContextMock.mockResolvedValue(ADMIN_TENANT);
    findPortalUserByEmailMock.mockResolvedValue(null);
    inviteToOrganizationMock.mockResolvedValue({ id: "invite-1" });

    const result = await inviteMember({}, makeFormData({ email: "new@example.com", role: UserRole.CUSTOMER_USER }));

    expect(inviteToOrganizationMock).toHaveBeenCalledWith({
      organizationId: "org-1",
      tenantId: "tenant-default",
      email: "new@example.com",
      role: UserRole.CUSTOMER_USER,
      invitedBy: "admin-1",
    });
    expect(sendOrganizationInviteEmailMock).toHaveBeenCalledWith("new@example.com", "raw-token", "Acme");
    expect(revalidatePathMock).toHaveBeenCalledWith("/settings");
    expect(result.success).toBeTruthy();
  });

  it("uses the requested tenant when the org has more than one", async () => {
    requireTenantContextMock.mockResolvedValue(ADMIN_TENANT);
    listTenantsMock.mockResolvedValue([
      { id: "tenant-default", isDefault: true },
      { id: "tenant-eu", isDefault: false },
    ]);
    findPortalUserByEmailMock.mockResolvedValue(null);
    inviteToOrganizationMock.mockResolvedValue({ id: "invite-1" });

    await inviteMember(
      {},
      makeFormData({ email: "new@example.com", role: UserRole.CUSTOMER_ADMIN, tenantId: "tenant-eu" }),
    );

    expect(inviteToOrganizationMock).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: "tenant-eu", role: UserRole.CUSTOMER_ADMIN }),
    );
  });

  it("surfaces a friendly error for a duplicate pending invitation", async () => {
    requireTenantContextMock.mockResolvedValue(ADMIN_TENANT);
    findPortalUserByEmailMock.mockResolvedValue(null);
    inviteToOrganizationMock.mockRejectedValue(new DuplicateInvitationError("dup"));

    const result = await inviteMember({}, makeFormData({ email: "new@example.com", role: UserRole.CUSTOMER_USER }));

    expect(result.error).toMatch(/pending invitation/i);
    expect(sendOrganizationInviteEmailMock).not.toHaveBeenCalled();
  });
});

describe("revokeInvitation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects (throws) when the caller isn't an org admin", async () => {
    requireTenantContextMock.mockResolvedValue(NON_ADMIN_TENANT);

    await expect(revokeInvitation("invite-1")).rejects.toThrow(/admin/i);
    expect(revokeInvitationMock).not.toHaveBeenCalled();
  });

  it("no-ops for an invitation that isn't pending for the caller's org", async () => {
    requireTenantContextMock.mockResolvedValue(ADMIN_TENANT);
    listPendingInvitationsMock.mockResolvedValue([]);

    await revokeInvitation("invite-1");

    expect(revokeInvitationMock).not.toHaveBeenCalled();
  });

  it("revokes a pending invitation belonging to the caller's org", async () => {
    requireTenantContextMock.mockResolvedValue(ADMIN_TENANT);
    listPendingInvitationsMock.mockResolvedValue([{ id: "invite-1" }]);

    await revokeInvitation("invite-1");

    expect(revokeInvitationMock).toHaveBeenCalledWith("invite-1");
    expect(revalidatePathMock).toHaveBeenCalledWith("/settings");
  });
});
