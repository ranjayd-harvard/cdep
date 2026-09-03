import { describe, expect, it, vi } from "vitest";
import { createFakeDb } from "@/test/fake-mongo";

const { getDbMock } = vi.hoisted(() => ({ getDbMock: vi.fn() }));

vi.mock("@/lib/mongodb", () => ({
  getDb: getDbMock,
}));

import { MongoOrganizationMembershipService } from "@/services/mongo/mongo-organization-membership-service";

describe("MongoOrganizationMembershipService", () => {
  it("requests to join, then approves, removing it from the pending list", async () => {
    getDbMock.mockResolvedValue(createFakeDb({}));
    const service = new MongoOrganizationMembershipService();

    const request = await service.requestToJoin("org-1", {
      userId: "user-1",
      userName: "Ada",
      userEmail: "ada@example.com",
    });

    expect(await service.findPendingRequestForUser("user-1")).toMatchObject({ id: request.id });
    expect(await service.listPendingRequests("org-1")).toHaveLength(1);

    await service.approveRequest(request.id, "admin-1");

    expect(await service.listPendingRequests("org-1")).toHaveLength(0);
    expect(await service.findPendingRequestForUser("user-1")).toBeNull();
  });

  it("rejects a request", async () => {
    getDbMock.mockResolvedValue(createFakeDb({}));
    const service = new MongoOrganizationMembershipService();

    const request = await service.requestToJoin("org-1", {
      userId: "user-1",
      userName: "Ada",
      userEmail: "ada@example.com",
    });
    await service.rejectRequest(request.id, "admin-1");

    expect(await service.findPendingRequestForUser("user-1")).toBeNull();
  });
});
