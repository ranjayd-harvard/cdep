import { describe, expect, it, vi } from "vitest";
import { createFakeDb } from "@/test/fake-mongo";

const { getDbMock } = vi.hoisted(() => ({ getDbMock: vi.fn() }));

vi.mock("@/lib/mongodb", () => ({
  getDb: getDbMock,
}));

import { MongoOrganizationInvitationService } from "@/services/mongo/mongo-organization-invitation-service";
import { UserRole } from "@/models";

describe("MongoOrganizationInvitationService", () => {
  it("invites, lists, and revokes an invitation", async () => {
    getDbMock.mockResolvedValue(createFakeDb({}));
    const service = new MongoOrganizationInvitationService();

    const invitation = await service.inviteToOrganization({
      organizationId: "org-1",
      tenantId: "tenant-1",
      email: "ada@example.com",
      role: UserRole.CUSTOMER_USER,
      invitedBy: "admin-1",
    });

    expect((await service.listPendingInvitations("org-1")).map((i) => i.id)).toContain(invitation.id);

    await service.revokeInvitation(invitation.id);

    expect(await service.listPendingInvitations("org-1")).toEqual([]);
  });
});
