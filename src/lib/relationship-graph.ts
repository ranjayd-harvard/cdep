import type { DataProduct, Dataset, Entitlement, Organization, Tenant } from "@/models";

/**
 * The graph node/edge shape returned by `GET /api/admin/data-relationships`
 * and consumed by the Data Relationships explorer
 * (`src/app/admin/data-relationships`). Node ids are the entity's own id
 * (already globally unique — `org-*`, `tenant-*`, `dp-*`, `ds-*` prefixes
 * never collide), so nodes/edges from separate expansion calls merge by
 * id without a translation layer.
 */
export type GraphNodeType = "organization" | "tenant" | "dataProduct" | "dataset";
export type GraphEdgeType = "OWNS" | "ENTITLED" | "USES";

export interface OrganizationNodeData {
  name: string;
  status: Organization["status"];
}
export interface TenantNodeData {
  name: string;
  status: Tenant["status"];
  organizationId: string;
  isDefault: boolean;
}
export interface DataProductNodeData {
  name: string;
  status: DataProduct["status"];
  domain: string;
  owner: string;
}
export interface DatasetNodeData {
  name: string;
  status: Dataset["status"];
  domain: string;
  format: string;
}

export interface GraphNode {
  id: string;
  type: GraphNodeType;
  data: OrganizationNodeData | TenantNodeData | DataProductNodeData | DatasetNodeData;
}

export interface EntitlementEdgeData {
  entitlementId: string;
  status: Entitlement["status"];
  validFrom: string;
  validUntil: string | null;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type: GraphEdgeType;
  data?: EntitlementEdgeData;
}

export interface RelationshipGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export function organizationNode(organization: Organization): GraphNode {
  return {
    id: organization.id,
    type: "organization",
    data: { name: organization.displayName, status: organization.status },
  };
}

export function tenantNode(tenant: Tenant): GraphNode {
  return {
    id: tenant.id,
    type: "tenant",
    data: {
      name: tenant.displayName,
      status: tenant.status,
      organizationId: tenant.organizationId,
      isDefault: tenant.isDefault,
    },
  };
}

export function dataProductNode(dataProduct: DataProduct): GraphNode {
  return {
    id: dataProduct.id,
    type: "dataProduct",
    data: {
      name: dataProduct.displayName,
      status: dataProduct.status,
      domain: dataProduct.domain,
      owner: dataProduct.owner,
    },
  };
}

export function datasetNode(dataset: Dataset): GraphNode {
  return {
    id: dataset.id,
    type: "dataset",
    data: { name: dataset.displayName, status: dataset.status, domain: dataset.domain, format: dataset.format },
  };
}

export function ownsEdge(organizationId: string, tenantId: string): GraphEdge {
  return { id: `owns-${organizationId}-${tenantId}`, source: organizationId, target: tenantId, type: "OWNS" };
}

export function usesEdge(dataProductId: string, datasetId: string): GraphEdge {
  return { id: `uses-${dataProductId}-${datasetId}`, source: dataProductId, target: datasetId, type: "USES" };
}

export function entitlementEdge(entitlement: Entitlement): GraphEdge {
  return {
    id: `entitled-${entitlement.id}`,
    source: entitlement.tenantId,
    target: entitlement.dataProductId,
    type: "ENTITLED",
    data: {
      entitlementId: entitlement.id,
      status: entitlement.status,
      validFrom: entitlement.grantedAt,
      validUntil: entitlement.expiresAt,
    },
  };
}
