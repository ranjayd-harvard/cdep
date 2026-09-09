"use client";

import { Badge, Button, EmptyState, StatusBadge } from "@/components/ui";
import type {
  DataProductNodeData,
  DatasetNodeData,
  GraphEdge,
  GraphNode,
  OrganizationNodeData,
  TenantNodeData,
} from "@/lib/relationship-graph";
import type { Organization } from "@/models";
import type { ExplorerState } from "./graph-state";
import { ConfirmButton } from "./confirm-button";
import {
  reactivateEntitlementAction,
  retireDataProductAction,
  retireDatasetAction,
  revokeEntitlementAction,
  setEntitlementExpiryAction,
  setOrganizationStatusAction,
  setTenantStatusAction,
} from "./actions";

export interface DetailPanelHandlers {
  onSelectNode: (node: GraphNode) => void;
  onOpenGrantEntitlement: (organizationId?: string, tenantId?: string) => void;
  onOpenAddTenant: (organizationId: string) => void;
  onOpenAddDataset: (dataProductId: string) => void;
  onOpenAssociateProduct: (datasetId: string) => void;
  onDissociateDataset: (dataProductId: string, datasetId: string) => void;
  onRefreshNode: (node: GraphNode) => void;
}

export interface DetailPanelProps {
  state: ExplorerState;
  organizations: Organization[];
  handlers: DetailPanelHandlers;
}

function edgesFrom(state: ExplorerState, sourceId: string): GraphEdge[] {
  return Object.values(state.edges).filter((edge) => edge.source === sourceId);
}
function edgesTo(state: ExplorerState, targetId: string): GraphEdge[] {
  return Object.values(state.edges).filter((edge) => edge.target === targetId);
}

export function DetailPanel({ state, organizations, handlers }: DetailPanelProps) {
  const selectedNode = state.selectedNodeId ? state.nodes[state.selectedNodeId] : null;
  const selectedEdge = state.selectedEdgeId ? state.edges[state.selectedEdgeId] : null;

  if (selectedEdge && selectedEdge.type === "ENTITLED" && selectedEdge.data) {
    const tenant = state.nodes[selectedEdge.source];
    const dataProduct = state.nodes[selectedEdge.target];
    return (
      <EntitlementDetail
        edge={selectedEdge}
        tenantName={tenant && "name" in tenant.data ? tenant.data.name : selectedEdge.source}
        dataProductName={dataProduct && "name" in dataProduct.data ? dataProduct.data.name : selectedEdge.target}
        tenantId={selectedEdge.source}
      />
    );
  }

  if (!selectedNode) {
    return (
      <div className="p-4">
        <EmptyState title="Nothing selected" description="Select an organization, tenant, data product, or dataset to see its details and available actions." />
      </div>
    );
  }

  switch (selectedNode.type) {
    case "organization":
      return <OrganizationDetail node={selectedNode} handlers={handlers} />;
    case "tenant":
      return <TenantDetail node={selectedNode} state={state} organizations={organizations} handlers={handlers} />;
    case "dataProduct":
      return <DataProductDetail node={selectedNode} state={state} handlers={handlers} />;
    case "dataset":
      return <DatasetDetailPanel node={selectedNode} state={state} handlers={handlers} />;
    default:
      return null;
  }
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium text-slate-900">{value}</dd>
    </div>
  );
}

function PanelHeader({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div className="border-b border-slate-200 p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{eyebrow}</p>
      <h2 className="mt-0.5 text-base font-semibold text-slate-900">{title}</h2>
    </div>
  );
}

function OrganizationDetail({ node, handlers }: { node: GraphNode; handlers: DetailPanelHandlers }) {
  const data = node.data as OrganizationNodeData;
  return (
    <div className="flex flex-col">
      <PanelHeader eyebrow="Organization" title={data.name} />
      <div className="flex flex-col gap-4 p-4">
        <dl className="grid grid-cols-2 gap-3">
          <Field label="Status" value={<StatusBadge status={data.status} />} />
          <Field label="ID" value={<span className="font-mono text-xs">{node.id}</span>} />
        </dl>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => handlers.onOpenAddTenant(node.id)}>
            + Tenant
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={async () => {
              await setOrganizationStatusAction(node.id, data.status === "active" ? "inactive" : "active");
              handlers.onRefreshNode(node);
            }}
          >
            {data.status === "active" ? "Deactivate" : "Activate"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function TenantDetail({
  node,
  state,
  organizations,
  handlers,
}: {
  node: GraphNode;
  state: ExplorerState;
  organizations: Organization[];
  handlers: DetailPanelHandlers;
}) {
  const data = node.data as TenantNodeData;
  const organization = organizations.find((org) => org.id === data.organizationId);
  const entitlementEdges = edgesFrom(state, node.id).filter((edge) => edge.type === "ENTITLED");

  return (
    <div className="flex flex-col">
      <PanelHeader eyebrow="Tenant" title={data.name} />
      <div className="flex flex-col gap-4 p-4">
        <dl className="grid grid-cols-2 gap-3">
          <Field label="Organization" value={organization?.displayName ?? data.organizationId} />
          <Field label="Status" value={<StatusBadge status={data.status} />} />
        </dl>

        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Entitlements</p>
          {entitlementEdges.length === 0 ? (
            <p className="text-sm text-slate-500">No data products granted yet.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {entitlementEdges.map((edge) => {
                const dataProduct = state.nodes[edge.target];
                return (
                  <li key={edge.id} className="flex items-center justify-between gap-2 rounded-md bg-slate-50 p-2">
                    <button
                      type="button"
                      className="truncate text-sm text-slate-900 hover:underline"
                      onClick={() => dataProduct && handlers.onSelectNode(dataProduct)}
                    >
                      {dataProduct && "name" in dataProduct.data ? dataProduct.data.name : edge.target}
                    </button>
                    <StatusBadge status={edge.data?.status ?? ""} />
                  </li>
                );
              })}
            </ul>
          )}
          <Button size="sm" className="mt-2" onClick={() => handlers.onOpenGrantEntitlement(data.organizationId, node.id)}>
            + Grant Entitlement
          </Button>
        </div>

        <Button
          size="sm"
          variant="secondary"
          className="self-start"
          onClick={async () => {
            await setTenantStatusAction(node.id, data.status === "active" ? "inactive" : "active");
            handlers.onRefreshNode(node);
          }}
        >
          {data.status === "active" ? "Disable Tenant" : "Activate Tenant"}
        </Button>
      </div>
    </div>
  );
}

function DataProductDetail({
  node,
  state,
  handlers,
}: {
  node: GraphNode;
  state: ExplorerState;
  handlers: DetailPanelHandlers;
}) {
  const data = node.data as DataProductNodeData;
  const datasetEdges = edgesFrom(state, node.id).filter((edge) => edge.type === "USES");
  const tenantEdges = edgesTo(state, node.id).filter((edge) => edge.type === "ENTITLED");

  return (
    <div className="flex flex-col">
      <PanelHeader eyebrow="Data Product" title={data.name} />
      <div className="flex flex-col gap-4 p-4">
        <dl className="grid grid-cols-2 gap-3">
          <Field label="Status" value={<StatusBadge status={data.status} />} />
          <Field label="Domain" value={data.domain} />
          <Field label="Owner" value={data.owner} />
          <Field label="Datasets" value={datasetEdges.length} />
          <Field label="Entitled Tenants" value={tenantEdges.length} />
        </dl>

        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Datasets</p>
          {datasetEdges.length === 0 ? (
            <p className="text-sm text-slate-500">No datasets associated yet.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {datasetEdges.map((edge) => {
                const dataset = state.nodes[edge.target];
                return (
                  <li key={edge.id} className="flex items-center justify-between gap-2 rounded-md bg-slate-50 p-2">
                    <button
                      type="button"
                      className="truncate text-sm text-slate-900 hover:underline"
                      onClick={() => dataset && handlers.onSelectNode(dataset)}
                    >
                      {dataset && "name" in dataset.data ? dataset.data.name : edge.target}
                    </button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handlers.onDissociateDataset(node.id, edge.target)}
                    >
                      Remove
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
          <Button size="sm" variant="secondary" className="mt-2" onClick={() => handlers.onOpenAddDataset(node.id)}>
            + Add Dataset
          </Button>
        </div>

        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Entitled Tenants</p>
          {tenantEdges.length === 0 ? (
            <p className="text-sm text-slate-500">No tenants entitled yet.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {tenantEdges.map((edge) => {
                const tenant = state.nodes[edge.source];
                return (
                  <li key={edge.id} className="flex items-center justify-between gap-2 rounded-md bg-slate-50 p-2">
                    <button
                      type="button"
                      className="truncate text-sm text-slate-900 hover:underline"
                      onClick={() => tenant && handlers.onSelectNode(tenant)}
                    >
                      {tenant && "name" in tenant.data ? tenant.data.name : edge.source}
                    </button>
                    <StatusBadge status={edge.data?.status ?? ""} />
                  </li>
                );
              })}
            </ul>
          )}
          <Button size="sm" variant="secondary" className="mt-2" onClick={() => handlers.onOpenGrantEntitlement(undefined, undefined)}>
            + Grant Access
          </Button>
        </div>

        <ConfirmButton
          size="sm"
          variant="danger"
          className="self-start"
          confirmLabel="Retire Data Product"
          confirmDescription={`Retiring ${data.name} marks it DEPRECATED. Existing entitlements are left in place.`}
          onConfirm={async () => {
            await retireDataProductAction(node.id);
            handlers.onRefreshNode(node);
          }}
        >
          Retire Data Product
        </ConfirmButton>
      </div>
    </div>
  );
}

function DatasetDetailPanel({
  node,
  state,
  handlers,
}: {
  node: GraphNode;
  state: ExplorerState;
  handlers: DetailPanelHandlers;
}) {
  const data = node.data as DatasetNodeData;
  const productEdges = edgesTo(state, node.id).filter((edge) => edge.type === "USES");

  return (
    <div className="flex flex-col">
      <PanelHeader eyebrow="Dataset" title={data.name} />
      <div className="flex flex-col gap-4 p-4">
        <dl className="grid grid-cols-2 gap-3">
          <Field label="Status" value={<StatusBadge status={data.status} />} />
          <Field label="Domain" value={data.domain} />
          <Field label="Format" value={data.format} />
        </dl>

        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Used By</p>
          {productEdges.length === 0 ? (
            <p className="text-sm text-slate-500">Not associated with any data product yet.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {productEdges.map((edge) => {
                const dataProduct = state.nodes[edge.source];
                return (
                  <li key={edge.id} className="flex items-center justify-between gap-2 rounded-md bg-slate-50 p-2">
                    <button
                      type="button"
                      className="truncate text-sm text-slate-900 hover:underline"
                      onClick={() => dataProduct && handlers.onSelectNode(dataProduct)}
                    >
                      {dataProduct && "name" in dataProduct.data ? dataProduct.data.name : edge.source}
                    </button>
                    <Button size="sm" variant="ghost" onClick={() => handlers.onDissociateDataset(edge.source, node.id)}>
                      Remove
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
          <Button size="sm" variant="secondary" className="mt-2" onClick={() => handlers.onOpenAssociateProduct(node.id)}>
            + Associate Data Product
          </Button>
        </div>

        <ConfirmButton
          size="sm"
          variant="danger"
          className="self-start"
          confirmLabel="Retire Dataset"
          confirmDescription={`Retiring ${data.name} marks it DEPRECATED. Existing associations are left in place.`}
          onConfirm={async () => {
            await retireDatasetAction(node.id);
            handlers.onRefreshNode(node);
          }}
        >
          Retire Dataset
        </ConfirmButton>
      </div>
    </div>
  );
}

function EntitlementDetail({
  edge,
  tenantName,
  dataProductName,
  tenantId,
}: {
  edge: GraphEdge;
  tenantName: string;
  dataProductName: string;
  tenantId: string;
}) {
  const data = edge.data!;
  return (
    <div className="flex flex-col">
      <PanelHeader eyebrow="Entitlement" title={`${tenantName} → ${dataProductName}`} />
      <div className="flex flex-col gap-4 p-4">
        <dl className="grid grid-cols-2 gap-3">
          <Field label="Tenant" value={tenantName} />
          <Field label="Data Product" value={dataProductName} />
          <Field label="Status" value={<StatusBadge status={data.status} />} />
          <Field label="Valid From" value={new Date(data.validFrom).toLocaleDateString()} />
          <Field
            label="Valid Until"
            value={data.validUntil ? new Date(data.validUntil).toLocaleDateString() : "No expiration"}
          />
        </dl>

        <form
          action={async (formData) => {
            await setEntitlementExpiryAction(tenantId, data.entitlementId, formData);
          }}
          className="flex items-end gap-2"
        >
          <div className="flex flex-col gap-1.5">
            <label htmlFor="validUntil" className="text-sm font-medium text-slate-700">
              Change valid until
            </label>
            <input
              id="validUntil"
              name="validUntil"
              type="date"
              defaultValue={data.validUntil ? data.validUntil.slice(0, 10) : ""}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-900/10"
            />
          </div>
          <Button type="submit" size="sm" variant="secondary">
            Save
          </Button>
        </form>

        <div className="flex gap-2">
          {data.status === "ACTIVE" ? (
            <ConfirmButton
              size="sm"
              variant="danger"
              confirmLabel="Revoke Entitlement"
              confirmDescription={`${tenantName} will no longer be authorized to access ${dataProductName}.`}
              onConfirm={() => revokeEntitlementAction(tenantId, data.entitlementId)}
            >
              Revoke
            </ConfirmButton>
          ) : (
            <Button size="sm" variant="secondary" onClick={() => reactivateEntitlementAction(tenantId, data.entitlementId)}>
              Reactivate
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

export function EdgeStatusBadgeLegend() {
  return (
    <div className="flex gap-2 p-2 text-xs text-slate-500">
      <Badge color="green">Active</Badge>
      <Badge color="red">Revoked</Badge>
      <Badge color="gray">Expired</Badge>
    </div>
  );
}
