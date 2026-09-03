import { describe, expect, it, vi } from "vitest";
import { createFakeDb } from "@/test/fake-mongo";

const { getDbMock } = vi.hoisted(() => ({ getDbMock: vi.fn() }));

vi.mock("@/lib/mongodb", () => ({
  getDb: getDbMock,
}));

import {
  createOrganization,
  findOrganizationById,
  listOrganizations,
  searchOrganizationsByName,
  setOrganizationStatus,
} from "@/lib/organization-directory";

describe("createOrganization", () => {
  it("provisions a new active organization with a slugified name and a findable id", async () => {
    getDbMock.mockResolvedValue(createFakeDb({}));

    const organization = await createOrganization({ displayName: "Acme Live Entertainment!" });

    expect(organization.displayName).toBe("Acme Live Entertainment!");
    expect(organization.name).toBe("acme-live-entertainment");
    expect(organization.status).toBe("active");
    expect(organization.id).toMatch(/^org-acme-live-entertainment-[0-9a-f]{6}$/);

    const found = await findOrganizationById(organization.id);
    expect(found?.id).toBe(organization.id);
  });

  it("gives two signups with the same company name distinct ids", async () => {
    getDbMock.mockResolvedValue(createFakeDb({}));

    const first = await createOrganization({ displayName: "Acme" });
    const second = await createOrganization({ displayName: "Acme" });

    expect(first.id).not.toBe(second.id);
  });
});

describe("searchOrganizationsByName", () => {
  it("matches case-insensitively on name or display name", async () => {
    getDbMock.mockResolvedValue(
      createFakeDb({
        organizations: [
          { _id: "org-1", name: "acme-live-entertainment", displayName: "Acme Live Entertainment", status: "active" },
          { _id: "org-2", name: "globex-events", displayName: "Globex Events", status: "active" },
        ],
      }),
    );

    const results = await searchOrganizationsByName("acme");

    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("org-1");
  });

  it("returns an empty list for a blank query without hitting the database", async () => {
    getDbMock.mockResolvedValue(createFakeDb({ organizations: [] }));

    const results = await searchOrganizationsByName("   ");

    expect(results).toEqual([]);
  });

  it("returns no matches for a query that doesn't hit any organization", async () => {
    getDbMock.mockResolvedValue(
      createFakeDb({
        organizations: [{ _id: "org-1", name: "acme", displayName: "Acme", status: "active" }],
      }),
    );

    const results = await searchOrganizationsByName("nonexistent");

    expect(results).toEqual([]);
  });
});

describe("listOrganizations", () => {
  it("returns every organization on the platform, regardless of name", async () => {
    getDbMock.mockResolvedValue(
      createFakeDb({
        organizations: [
          { _id: "org-1", name: "acme", displayName: "Acme", status: "active" },
          { _id: "org-2", name: "globex-events", displayName: "Globex Events", status: "inactive" },
        ],
      }),
    );

    const results = await listOrganizations();

    expect(results.map((o) => o.id).sort()).toEqual(["org-1", "org-2"]);
  });
});

describe("setOrganizationStatus", () => {
  it("activates/deactivates an organization (Admin Console)", async () => {
    getDbMock.mockResolvedValue(createFakeDb({}));
    const organization = await createOrganization({ displayName: "Acme" });

    await setOrganizationStatus(organization.id, "inactive");
    expect((await findOrganizationById(organization.id))?.status).toBe("inactive");

    await setOrganizationStatus(organization.id, "active");
    expect((await findOrganizationById(organization.id))?.status).toBe("active");
  });
});
