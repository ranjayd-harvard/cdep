import { describe, expect, it, vi } from "vitest";
import { createFakeDb } from "@/test/fake-mongo";

const { getDbMock } = vi.hoisted(() => ({ getDbMock: vi.fn() }));

vi.mock("@/lib/mongodb", () => ({
  getDb: getDbMock,
}));

import {
  approveMembershipRequest,
  createMembershipRequest,
  DuplicateMembershipRequestError,
  findPendingRequestForUser,
  listPendingRequestsForOrganization,
  rejectMembershipRequest,
} from "@/lib/organization-membership-directory";
import { MembershipRequestStatus } from "@/models";

describe("organization membership requests", () => {
  it("creates a pending request", async () => {
    getDbMock.mockResolvedValue(createFakeDb({}));

    const request = await createMembershipRequest({
      organizationId: "org-1",
      userId: "user-1",
      userName: "Ada",
      userEmail: "ada@example.com",
    });

    expect(request.status).toBe(MembershipRequestStatus.PENDING);
    expect(await findPendingRequestForUser("user-1")).toMatchObject({ id: request.id });
  });

  it("refuses a second pending request from the same user", async () => {
    getDbMock.mockResolvedValue(createFakeDb({}));
    await createMembershipRequest({ organizationId: "org-1", userId: "user-1", userName: "Ada", userEmail: "ada@example.com" });

    await expect(
      createMembershipRequest({ organizationId: "org-2", userId: "user-1", userName: "Ada", userEmail: "ada@example.com" }),
    ).rejects.toThrow(DuplicateMembershipRequestError);
  });

  it("lists only PENDING requests for an organization, oldest first", async () => {
    getDbMock.mockResolvedValue(createFakeDb({}));
    const first = await createMembershipRequest({
      organizationId: "org-1",
      userId: "user-1",
      userName: "Ada",
      userEmail: "ada@example.com",
    });
    const second = await createMembershipRequest({
      organizationId: "org-1",
      userId: "user-2",
      userName: "Grace",
      userEmail: "grace@example.com",
    });
    await approveMembershipRequest(first.id, "admin-1");

    const pending = await listPendingRequestsForOrganization("org-1");

    expect(pending.map((r) => r.id)).toEqual([second.id]);
  });

  it("lets a rejected requester submit a new request immediately", async () => {
    getDbMock.mockResolvedValue(createFakeDb({}));
    const request = await createMembershipRequest({
      organizationId: "org-1",
      userId: "user-1",
      userName: "Ada",
      userEmail: "ada@example.com",
    });
    await rejectMembershipRequest(request.id, "admin-1");

    expect(await findPendingRequestForUser("user-1")).toBeNull();

    const retry = await createMembershipRequest({
      organizationId: "org-2",
      userId: "user-1",
      userName: "Ada",
      userEmail: "ada@example.com",
    });
    expect(retry.status).toBe(MembershipRequestStatus.PENDING);
  });
});
