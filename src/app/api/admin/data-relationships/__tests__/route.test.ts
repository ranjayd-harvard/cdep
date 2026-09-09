import { describe, expect, it, vi, beforeEach } from "vitest";

const {
  requireApiSuperuserContextMock,
  listOrganizationsMock,
  getOrganizationMock,
  searchOrganizationsByNameMock,
  listTenantsMock,
  getTenantMock,
  getEntitlementsMock,
  listEntitlementsForDataProductMock,
  findDataProductByIdMock,
  findDataProductsByIdsMock,
  searchDataProductsByNameMock,
  findDatasetByIdMock,
  findDatasetsByIdsMock,
  searchDatasetsByNameMock,
  listDataProductIdsForDatasetMock,
  listDatasetIdsForDataProductMock,
  findTenantsByIdsMock,
  searchTenantsByNameMock,
} = vi.hoisted(() => ({
  requireApiSuperuserContextMock: vi.fn(),
  listOrganizationsMock: vi.fn(),
  getOrganizationMock: vi.fn(),
  searchOrganizationsByNameMock: vi.fn(),
  listTenantsMock: vi.fn(),
  getTenantMock: vi.fn(),
  getEntitlementsMock: vi.fn(),
  listEntitlementsForDataProductMock: vi.fn(),
  findDataProductByIdMock: vi.fn(),
  findDataProductsByIdsMock: vi.fn(),
  searchDataProductsByNameMock: vi.fn(),
  findDatasetByIdMock: vi.fn(),
  findDatasetsByIdsMock: vi.fn(),
  searchDatasetsByNameMock: vi.fn(),
  listDataProductIdsForDatasetMock: vi.fn(),
  listDatasetIdsForDataProductMock: vi.fn(),
  findTenantsByIdsMock: vi.fn(),
  searchTenantsByNameMock: vi.fn(),
}));

vi.mock("@/lib/admin", () => ({ requireApiSuperuserContext: requireApiSuperuserContextMock }));
vi.mock("@/services", () => ({
  services: {
    organizations: {
      listOrganizations: listOrganizationsMock,
      getOrganization: getOrganizationMock,
      searchOrganizationsByName: searchOrganizationsByNameMock,
    },
    tenants: { listTenants: listTenantsMock, getTenant: getTenantMock },
    entitlements: {
      getEntitlements: getEntitlementsMock,
      listEntitlementsForDataProduct: listEntitlementsForDataProductMock,
    },
  },
}));
vi.mock("@/lib/data-product-directory", () => ({
  findDataProductById: findDataProductByIdMock,
  findDataProductsByIds: findDataProductsByIdsMock,
  searchDataProductsByName: searchDataProductsByNameMock,
}));
vi.mock("@/lib/dataset-directory", () => ({
  findDatasetById: findDatasetByIdMock,
  findDatasetsByIds: findDatasetsByIdsMock,
  searchDatasetsByName: searchDatasetsByNameMock,
}));
vi.mock("@/lib/data-product-dataset-directory", () => ({
  listDataProductIdsForDataset: listDataProductIdsForDatasetMock,
  listDatasetIdsForDataProduct: listDatasetIdsForDataProductMock,
}));
vi.mock("@/lib/tenant-directory", () => ({
  findTenantsByIds: findTenantsByIdsMock,
  searchTenantsByName: searchTenantsByNameMock,
}));

import { GET } from "@/app/api/admin/data-relationships/route";

const ADMIN = { userId: "user-admin", name: "Platform Admin", email: "admin@platform.example.com" };

function requestWith(params: string): Request {
  return new Request(`http://localhost/api/admin/data-relationships${params}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  requireApiSuperuserContextMock.mockResolvedValue({ ok: true, admin: ADMIN });
});

describe("GET /api/admin/data-relationships", () => {
  it("returns 401 when unauthenticated", async () => {
    requireApiSuperuserContextMock.mockResolvedValue({ ok: false, status: 401 });

    const response = await GET(requestWith(""));

    expect(response.status).toBe(401);
  });

  it("returns 403 when authenticated but not a superuser", async () => {
    requireApiSuperuserContextMock.mockResolvedValue({ ok: false, status: 403 });

    const response = await GET(requestWith(""));

    expect(response.status).toBe(403);
  });

  it("returns the Organizations-only root view with no params", async () => {
    listOrganizationsMock.mockResolvedValue([{ id: "org-1", displayName: "Acme", status: "active" }]);

    const response = await GET(requestWith(""));
    const body = await response.json();

    expect(body.nodes).toEqual([{ id: "org-1", type: "organization", data: { name: "Acme", status: "active" } }]);
    expect(body.edges).toEqual([]);
  });

  it("expands an Organization into its Tenants with OWNS edges", async () => {
    getOrganizationMock.mockResolvedValue({ id: "org-1", displayName: "Acme", status: "active" });
    listTenantsMock.mockResolvedValue([
      { id: "tenant-1", displayName: "Production", status: "active", organizationId: "org-1", isDefault: true },
    ]);

    const response = await GET(requestWith("?organizationId=org-1"));
    const body = await response.json();

    expect(body.nodes).toHaveLength(2);
    expect(body.nodes[0].type).toBe("organization");
    expect(body.nodes[1].type).toBe("tenant");
    expect(body.edges).toEqual([{ id: "owns-org-1-tenant-1", source: "org-1", target: "tenant-1", type: "OWNS" }]);
  });

  it("expands a Tenant into its entitled Data Products with ENTITLED edges", async () => {
    getTenantMock.mockResolvedValue({
      id: "tenant-1",
      displayName: "Production",
      status: "active",
      organizationId: "org-1",
      isDefault: true,
    });
    getEntitlementsMock.mockResolvedValue([
      {
        id: "ent-1",
        tenantId: "tenant-1",
        dataProductId: "dp-1",
        status: "ACTIVE",
        grantedAt: "2026-01-01T00:00:00Z",
        grantedBy: "user-admin",
        expiresAt: null,
      },
    ]);
    findDataProductsByIdsMock.mockResolvedValue([
      { id: "dp-1", displayName: "Event Performance", status: "ACTIVE", domain: "Events", owner: "Team A" },
    ]);

    const response = await GET(requestWith("?tenantId=tenant-1"));
    const body = await response.json();

    expect(body.nodes.map((n: { type: string }) => n.type)).toEqual(["tenant", "dataProduct"]);
    expect(body.edges).toEqual([
      {
        id: "entitled-ent-1",
        source: "tenant-1",
        target: "dp-1",
        type: "ENTITLED",
        data: { entitlementId: "ent-1", status: "ACTIVE", validFrom: "2026-01-01T00:00:00Z", validUntil: null },
      },
    ]);
  });

  it("expands a Data Product into its Datasets (USES) and entitled Tenants (ENTITLED)", async () => {
    findDataProductByIdMock.mockResolvedValue({
      id: "dp-1",
      displayName: "Event Performance",
      status: "ACTIVE",
      domain: "Events",
      owner: "Team A",
    });
    listDatasetIdsForDataProductMock.mockResolvedValue(["ds-1"]);
    findDatasetsByIdsMock.mockResolvedValue([
      { id: "ds-1", displayName: "Ticket Sales", status: "ACTIVE", domain: "Events", format: "CSV" },
    ]);
    listEntitlementsForDataProductMock.mockResolvedValue([
      {
        id: "ent-1",
        tenantId: "tenant-1",
        dataProductId: "dp-1",
        status: "ACTIVE",
        grantedAt: "2026-01-01T00:00:00Z",
        grantedBy: "user-admin",
        expiresAt: null,
      },
    ]);
    findTenantsByIdsMock.mockResolvedValue([
      { id: "tenant-1", displayName: "Production", status: "active", organizationId: "org-1", isDefault: true },
    ]);

    const response = await GET(requestWith("?dataProductId=dp-1"));
    const body = await response.json();

    expect(body.nodes.map((n: { type: string }) => n.type)).toEqual(["dataProduct", "dataset", "tenant"]);
    expect(body.edges).toEqual([
      { id: "uses-dp-1-ds-1", source: "dp-1", target: "ds-1", type: "USES" },
      {
        id: "entitled-ent-1",
        source: "tenant-1",
        target: "dp-1",
        type: "ENTITLED",
        data: { entitlementId: "ent-1", status: "ACTIVE", validFrom: "2026-01-01T00:00:00Z", validUntil: null },
      },
    ]);
  });

  it("expands a Dataset into the Data Products that use it, reversing the USES edge", async () => {
    findDatasetByIdMock.mockResolvedValue({
      id: "ds-shared",
      displayName: "Location Master",
      status: "ACTIVE",
      domain: "Reference",
      format: "Parquet",
    });
    listDataProductIdsForDatasetMock.mockResolvedValue(["dp-1", "dp-2"]);
    findDataProductsByIdsMock.mockResolvedValue([
      { id: "dp-1", displayName: "Commerce & Finance", status: "ACTIVE", domain: "Finance", owner: "Team A" },
      { id: "dp-2", displayName: "Events & Operations", status: "ACTIVE", domain: "Events", owner: "Team B" },
    ]);

    const response = await GET(requestWith("?datasetId=ds-shared"));
    const body = await response.json();

    expect(body.nodes.map((n: { type: string; id: string }) => `${n.type}:${n.id}`)).toEqual([
      "dataset:ds-shared",
      "dataProduct:dp-1",
      "dataProduct:dp-2",
    ]);
    expect(body.edges).toEqual([
      { id: "uses-dp-1-ds-shared", source: "dp-1", target: "ds-shared", type: "USES" },
      { id: "uses-dp-2-ds-shared", source: "dp-2", target: "ds-shared", type: "USES" },
    ]);
  });

  it("searches across every entity type and returns no edges", async () => {
    searchOrganizationsByNameMock.mockResolvedValue([{ id: "org-1", displayName: "Acme", status: "active" }]);
    searchTenantsByNameMock.mockResolvedValue([]);
    searchDataProductsByNameMock.mockResolvedValue([
      { id: "dp-1", displayName: "Ticket Performance", status: "ACTIVE", domain: "Events", owner: "Team A" },
    ]);
    searchDatasetsByNameMock.mockResolvedValue([]);

    const response = await GET(requestWith("?search=ticket"));
    const body = await response.json();

    expect(searchOrganizationsByNameMock).toHaveBeenCalledWith("ticket");
    expect(searchDataProductsByNameMock).toHaveBeenCalledWith("ticket");
    expect(body.nodes.map((n: { type: string }) => n.type)).toEqual(["organization", "dataProduct"]);
    expect(body.edges).toEqual([]);
  });
});
