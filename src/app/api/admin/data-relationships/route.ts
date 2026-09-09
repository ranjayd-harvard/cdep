import { NextResponse } from "next/server";
import { requireApiSuperuserContext } from "@/lib/admin";
import { services } from "@/services";
import { findDataProductById, findDataProductsByIds, searchDataProductsByName } from "@/lib/data-product-directory";
import { findDatasetById, findDatasetsByIds, searchDatasetsByName } from "@/lib/dataset-directory";
import { listDataProductIdsForDataset, listDatasetIdsForDataProduct } from "@/lib/data-product-dataset-directory";
import { findTenantsByIds, searchTenantsByName } from "@/lib/tenant-directory";
import {
  dataProductNode,
  datasetNode,
  entitlementEdge,
  organizationNode,
  ownsEdge,
  tenantNode,
  usesEdge,
  type RelationshipGraph,
} from "@/lib/relationship-graph";

async function rootView(): Promise<RelationshipGraph> {
  const organizations = await services.organizations.listOrganizations();
  return { nodes: organizations.map(organizationNode), edges: [] };
}

async function expandOrganization(organizationId: string): Promise<RelationshipGraph> {
  const [organization, tenants] = await Promise.all([
    services.organizations.getOrganization(organizationId),
    services.tenants.listTenants(organizationId),
  ]);

  return {
    nodes: [
      ...(organization ? [organizationNode(organization)] : []),
      ...tenants.map(tenantNode),
    ],
    edges: tenants.map((tenant) => ownsEdge(organizationId, tenant.id)),
  };
}

async function expandTenant(tenantId: string): Promise<RelationshipGraph> {
  const [tenant, entitlements] = await Promise.all([
    services.tenants.getTenant(tenantId),
    services.entitlements.getEntitlements(tenantId),
  ]);
  const dataProductIds = [...new Set(entitlements.map((entitlement) => entitlement.dataProductId))];
  const dataProducts = await findDataProductsByIds(dataProductIds);

  return {
    nodes: [
      ...(tenant ? [tenantNode(tenant)] : []),
      ...dataProducts.map(dataProductNode),
    ],
    edges: entitlements.map(entitlementEdge),
  };
}

async function expandDataProduct(dataProductId: string): Promise<RelationshipGraph> {
  const [dataProduct, datasetIds, entitlements] = await Promise.all([
    findDataProductById(dataProductId),
    listDatasetIdsForDataProduct(dataProductId),
    services.entitlements.listEntitlementsForDataProduct(dataProductId),
  ]);
  const tenantIds = [...new Set(entitlements.map((entitlement) => entitlement.tenantId))];
  const [datasets, tenants] = await Promise.all([findDatasetsByIds(datasetIds), findTenantsByIds(tenantIds)]);

  return {
    nodes: [
      ...(dataProduct ? [dataProductNode(dataProduct)] : []),
      ...datasets.map(datasetNode),
      ...tenants.map(tenantNode),
    ],
    edges: [...datasets.map((dataset) => usesEdge(dataProductId, dataset.id)), ...entitlements.map(entitlementEdge)],
  };
}

async function expandDataset(datasetId: string): Promise<RelationshipGraph> {
  const [dataset, dataProductIds] = await Promise.all([
    findDatasetById(datasetId),
    listDataProductIdsForDataset(datasetId),
  ]);
  const dataProducts = await findDataProductsByIds(dataProductIds);

  return {
    nodes: [...(dataset ? [datasetNode(dataset)] : []), ...dataProducts.map(dataProductNode)],
    edges: dataProducts.map((dataProduct) => usesEdge(dataProduct.id, datasetId)),
  };
}

async function searchGraph(query: string): Promise<RelationshipGraph> {
  const [organizations, tenants, dataProducts, datasets] = await Promise.all([
    services.organizations.searchOrganizationsByName(query),
    searchTenantsByName(query),
    searchDataProductsByName(query),
    searchDatasetsByName(query),
  ]);

  return {
    nodes: [
      ...organizations.map(organizationNode),
      ...tenants.map(tenantNode),
      ...dataProducts.map(dataProductNode),
      ...datasets.map(datasetNode),
    ],
    edges: [],
  };
}

/**
 * The relationship graph, expanded progressively — never the whole
 * graph at once (see spec's scale requirements). Exactly one of
 * `organizationId`/`tenantId`/`dataProductId`/`datasetId`/`search` is
 * expected per call; with none given, returns the root (Organizations
 * only) view. The client (`src/app/admin/data-relationships`) merges
 * each call's nodes/edges into whatever subgraph it already has, keyed
 * by id.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const auth = await requireApiSuperuserContext();
  if (!auth.ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: auth.status });
  }

  const { searchParams } = new URL(request.url);
  const search = searchParams.get("search");
  const datasetId = searchParams.get("datasetId");
  const dataProductId = searchParams.get("dataProductId");
  const tenantId = searchParams.get("tenantId");
  const organizationId = searchParams.get("organizationId");

  if (search) {
    return NextResponse.json(await searchGraph(search));
  }
  if (datasetId) {
    return NextResponse.json(await expandDataset(datasetId));
  }
  if (dataProductId) {
    return NextResponse.json(await expandDataProduct(dataProductId));
  }
  if (tenantId) {
    return NextResponse.json(await expandTenant(tenantId));
  }
  if (organizationId) {
    return NextResponse.json(await expandOrganization(organizationId));
  }
  return NextResponse.json(await rootView());
}
