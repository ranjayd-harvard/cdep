import { describe, expect, it, vi } from "vitest";
import { createFakeDb } from "@/test/fake-mongo";

const { getDbMock } = vi.hoisted(() => ({ getDbMock: vi.fn() }));

vi.mock("@/lib/mongodb", () => ({
  getDb: getDbMock,
}));

import {
  acceptInvitation,
  createInvitation,
  declineInvitation,
  DuplicateInvitationError,
  findInvitationById,
  findPendingInvitationByEmail,
  listPendingInvitationsForOrganization,
  revokeInvitation,
} from "@/lib/organization-invitation-directory";
import { UserRole } from "@/models";

describe("organization invitations", () => {
  it("creates a pending invitation, normalizing the email", async () => {
    getDbMock.mockResolvedValue(createFakeDb({}));

    const invitation = await createInvitation({
      organizationId: "org-1",
      tenantId: "tenant-1",
      email: "Ada@Example.com",
      role: UserRole.CUSTOMER_USER,
      invitedBy: "admin-1",
    });

    expect(invitation.email).toBe("ada@example.com");
    expect(invitation.status).toBe("PENDING");
    expect(await findPendingInvitationByEmail("ADA@EXAMPLE.COM")).toMatchObject({ id: invitation.id });
  });

  it("refuses a second pending invitation for the same email, from any org", async () => {
    getDbMock.mockResolvedValue(createFakeDb({}));
    await createInvitation({
      organizationId: "org-1",
      tenantId: "tenant-1",
      email: "ada@example.com",
      role: UserRole.CUSTOMER_USER,
      invitedBy: "admin-1",
    });

    await expect(
      createInvitation({
        organizationId: "org-2",
        tenantId: "tenant-2",
        email: "ada@example.com",
        role: UserRole.CUSTOMER_ADMIN,
        invitedBy: "admin-2",
      }),
    ).rejects.toThrow(DuplicateInvitationError);
  });

  it("lists only PENDING invitations for an organization, oldest first", async () => {
    getDbMock.mockResolvedValue(createFakeDb({}));
    const first = await createInvitation({
      organizationId: "org-1",
      tenantId: "tenant-1",
      email: "ada@example.com",
      role: UserRole.CUSTOMER_USER,
      invitedBy: "admin-1",
    });
    const second = await createInvitation({
      organizationId: "org-1",
      tenantId: "tenant-1",
      email: "grace@example.com",
      role: UserRole.CUSTOMER_USER,
      invitedBy: "admin-1",
    });
    await acceptInvitation(first.id);

    const pending = await listPendingInvitationsForOrganization("org-1");

    expect(pending.map((i) => i.id)).toEqual([second.id]);
  });

  it("accepts an invitation and lets a declined invitee be re-invited", async () => {
    getDbMock.mockResolvedValue(createFakeDb({}));
    const invitation = await createInvitation({
      organizationId: "org-1",
      tenantId: "tenant-1",
      email: "ada@example.com",
      role: UserRole.CUSTOMER_USER,
      invitedBy: "admin-1",
    });

    await declineInvitation(invitation.id);
    expect(await findPendingInvitationByEmail("ada@example.com")).toBeNull();
    expect((await findInvitationById(invitation.id))?.status).toBe("DECLINED");

    const retry = await createInvitation({
      organizationId: "org-1",
      tenantId: "tenant-1",
      email: "ada@example.com",
      role: UserRole.CUSTOMER_ADMIN,
      invitedBy: "admin-1",
    });
    expect(retry.status).toBe("PENDING");
  });

  it("revokes a pending invitation", async () => {
    getDbMock.mockResolvedValue(createFakeDb({}));
    const invitation = await createInvitation({
      organizationId: "org-1",
      tenantId: "tenant-1",
      email: "ada@example.com",
      role: UserRole.CUSTOMER_USER,
      invitedBy: "admin-1",
    });

    await revokeInvitation(invitation.id);

    expect(await findPendingInvitationByEmail("ada@example.com")).toBeNull();
    expect((await findInvitationById(invitation.id))?.status).toBe("REVOKED");
  });
});
