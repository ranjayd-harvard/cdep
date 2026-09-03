import { describe, expect, it, vi } from "vitest";
import { createFakeDb } from "@/test/fake-mongo";

const { getDbMock } = vi.hoisted(() => ({ getDbMock: vi.fn() }));

vi.mock("@/lib/mongodb", () => ({
  getDb: getDbMock,
}));

import { MongoOrganizationService } from "@/services/mongo/mongo-organization-service";

describe("MongoOrganizationService", () => {
  it("creates and looks up an organization, and finds it by search", async () => {
    getDbMock.mockResolvedValue(createFakeDb({}));
    const service = new MongoOrganizationService();

    const org = await service.createOrganization({ displayName: "Acme" });

    expect(await service.getOrganization(org.id)).toMatchObject({ id: org.id });
    expect(await service.getOrganization("org-does-not-exist")).toBeNull();

    const results = await service.searchOrganizationsByName("acme");
    expect(results.map((r) => r.id)).toContain(org.id);
  });
});
