"use client";

import { useEffect, useMemo, useReducer, useState } from "react";
import { ChevronsLeft, ChevronsRight, Search } from "lucide-react";
import { Input, Modal, Select } from "@/components/ui";
import type { DataProduct, Dataset, Organization } from "@/models";
import type { GraphNode, GraphNodeType } from "@/lib/relationship-graph";
import {
  createInitialState,
  explorerReducer,
  fetchExpand,
  fetchSearch,
  scopedNodeIds,
  type RelationshipScope,
} from "./graph-state";
import { RelationshipTree } from "./relationship-tree";
import { RelationshipGraphCanvas } from "./relationship-graph";
import { DetailPanel } from "./detail-panel";
import { CreateMenu, type CreateMenuAction } from "./create-menu";
import { CreateTenantModal } from "./create-tenant-modal";
import { CreateDatasetModal } from "./create-dataset-modal";
import { GrantEntitlementModal, type TenantOption } from "./grant-entitlement-modal";
import { AddDatasetModal } from "./add-dataset-modal";
import { AssociateProductModal } from "./associate-product-modal";
import { CreateOrganizationForm } from "@/app/admin/organizations/create-organization-form";
import { CreateDataProductForm } from "@/app/admin/data-products/create-data-product-form";
import { dissociateDatasetAction } from "./actions";

const ENTITY_TYPES: GraphNodeType[] = ["organization", "tenant", "dataProduct", "dataset"];
const ENTITY_LABEL: Record<GraphNodeType, string> = {
  organization: "Organizations",
  tenant: "Tenants",
  dataProduct: "Data Products",
  dataset: "Datasets",
};

type ModalState =
  | { kind: null }
  | { kind: "createOrganization" }
  | { kind: "createDataProduct" }
  | { kind: "createDataset" }
  | { kind: "createTenant"; organizationId: string; organizationName: string }
  | { kind: "grantEntitlement"; organizationId?: string; tenantId?: string }
  | { kind: "addDataset"; dataProductId: string; dataProductName: string }
  | { kind: "associateProduct"; datasetId: string; datasetName: string };

export interface DataRelationshipsExplorerProps {
  initialNodes: GraphNode[];
  dataProducts: DataProduct[];
  datasets: Dataset[];
}

export function DataRelationshipsExplorer({ initialNodes, dataProducts, datasets }: DataRelationshipsExplorerProps) {
  const [state, dispatch] = useReducer(explorerReducer, initialNodes, createInitialState);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [entityTypeFilter, setEntityTypeFilter] = useState<Record<GraphNodeType, boolean>>({
    organization: true,
    tenant: true,
    dataProduct: true,
    dataset: true,
  });
  const [scope, setScope] = useState<RelationshipScope>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<GraphNode[]>([]);
  const [modal, setModal] = useState<ModalState>({ kind: null });

  const organizations: Organization[] = useMemo(
    () =>
      initialNodes
        .filter((node) => node.type === "organization")
        .map((node) => ({ id: node.id, name: node.id, displayName: (node.data as { name: string }).name, status: (node.data as { status: Organization["status"] }).status })),
    [initialNodes],
  );

  async function handleSelectNode(node: GraphNode) {
    dispatch({ type: "selectNode", nodeId: node.id });
    if (!state.expanded[node.id]) {
      const graph = await fetchExpand(node.type, node.id);
      dispatch({ type: "merge", graph, parentId: node.id });
    }
  }

  async function handleRefreshNode(node: GraphNode) {
    const graph = await fetchExpand(node.type, node.id);
    dispatch({ type: "merge", graph, parentId: node.id });
  }

  function handleToggleCollapse(nodeId: string) {
    if (state.expanded[nodeId]) {
      dispatch({ type: "collapse", nodeId });
    } else {
      const node = state.nodes[nodeId];
      if (node) handleSelectNode(node);
    }
  }

  async function loadTenants(organizationId: string): Promise<TenantOption[]> {
    const graph = await fetchExpand("organization", organizationId);
    dispatch({ type: "merge", graph, parentId: organizationId });
    return graph.nodes
      .filter((node) => node.type === "tenant")
      .map((node) => ({ id: node.id, displayName: (node.data as { name: string }).name }));
  }

  useEffect(() => {
    const trimmed = searchQuery.trim();
    if (!trimmed) {
      return;
    }
    const timeout = setTimeout(async () => {
      const graph = await fetchSearch(trimmed);
      setSearchResults(graph.nodes);
    }, 250);
    return () => clearTimeout(timeout);
  }, [searchQuery]);

  const displayedSearchResults = searchQuery.trim() ? searchResults : [];

  const scopeIds = scopedNodeIds(state, scope, state.selectedNodeId);
  const visibleIds = useMemo(() => {
    const ids = Object.keys(state.nodes).filter((id) => {
      const node = state.nodes[id];
      if (!entityTypeFilter[node.type]) return false;
      if (scopeIds && !scopeIds.has(id)) return false;
      return true;
    });
    return new Set(ids);
  }, [state.nodes, entityTypeFilter, scopeIds]);

  function handleCreateMenuSelect(action: CreateMenuAction) {
    const selectedNode = state.selectedNodeId ? state.nodes[state.selectedNodeId] : null;
    switch (action) {
      case "organization":
        setModal({ kind: "createOrganization" });
        break;
      case "dataProduct":
        setModal({ kind: "createDataProduct" });
        break;
      case "dataset":
        setModal({ kind: "createDataset" });
        break;
      case "tenant": {
        const organizationId = selectedNode?.type === "organization" ? selectedNode.id : organizations[0]?.id;
        const organization = organizations.find((org) => org.id === organizationId);
        if (organizationId && organization) {
          setModal({ kind: "createTenant", organizationId, organizationName: organization.displayName });
        }
        break;
      }
      case "entitlement": {
        if (selectedNode?.type === "tenant") {
          setModal({
            kind: "grantEntitlement",
            organizationId: (selectedNode.data as { organizationId: string }).organizationId,
            tenantId: selectedNode.id,
          });
        } else if (selectedNode?.type === "organization") {
          setModal({ kind: "grantEntitlement", organizationId: selectedNode.id });
        } else {
          setModal({ kind: "grantEntitlement" });
        }
        break;
      }
    }
  }

  const associatedDatasetIdsForProduct = (dataProductId: string) =>
    new Set(
      Object.values(state.edges)
        .filter((edge) => edge.type === "USES" && edge.source === dataProductId)
        .map((edge) => edge.target),
    );
  const associatedProductIdsForDataset = (datasetId: string) =>
    new Set(
      Object.values(state.edges)
        .filter((edge) => edge.type === "USES" && edge.target === datasetId)
        .map((edge) => edge.source),
    );

  return (
    <div className="flex flex-1 flex-col gap-3 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative w-72">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" aria-hidden="true" />
          <Input
            placeholder="Search organizations, tenants, products, datasets…"
            className="pl-8"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
          />
          {displayedSearchResults.length > 0 ? (
            <div className="absolute z-20 mt-1 w-full rounded-md border border-slate-200 bg-white py-1 shadow-lg">
              {displayedSearchResults.map((node) => (
                <button
                  key={node.id}
                  type="button"
                  className="flex w-full items-center justify-between px-3 py-1.5 text-left text-sm hover:bg-slate-50"
                  onClick={() => {
                    dispatch({ type: "merge", graph: { nodes: [node], edges: [] } });
                    handleSelectNode(node);
                    setSearchQuery("");
                    setSearchResults([]);
                  }}
                >
                  <span className="truncate text-slate-900">{"name" in node.data ? node.data.name : node.id}</span>
                  <span className="ml-2 shrink-0 text-xs text-slate-400">{ENTITY_LABEL[node.type]}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <CreateMenu onSelect={handleCreateMenuSelect} />
      </div>

      <div className="flex flex-wrap items-center gap-4 rounded-lg border border-slate-200 bg-white p-3 text-sm">
        <div className="flex flex-wrap items-center gap-3">
          {ENTITY_TYPES.map((type) => (
            <label key={type} className="flex items-center gap-1.5 text-slate-700">
              <input
                type="checkbox"
                checked={entityTypeFilter[type]}
                onChange={(event) => setEntityTypeFilter((prev) => ({ ...prev, [type]: event.target.checked }))}
                className="rounded border-slate-300"
              />
              {ENTITY_LABEL[type]}
            </label>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-slate-400">Show</span>
          <Select
            options={[
              { label: "All relationships", value: "all" },
              { label: "Upstream", value: "upstream" },
              { label: "Downstream", value: "downstream" },
              { label: "Direct only", value: "direct" },
            ]}
            value={scope}
            onChange={(event) => setScope(event.target.value as RelationshipScope)}
            className="py-1.5 text-xs"
          />
        </div>
      </div>

      <div className="flex flex-1 gap-3 overflow-hidden">
        {!leftCollapsed ? (
          <div className="flex w-64 shrink-0 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white">
            <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Relationships</span>
              <button type="button" onClick={() => setLeftCollapsed(true)} aria-label="Collapse tree panel">
                <ChevronsLeft className="h-4 w-4 text-slate-400" />
              </button>
            </div>
            <RelationshipTree state={state} onSelect={handleSelectNode} onToggleCollapse={handleToggleCollapse} />
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setLeftCollapsed(false)}
            aria-label="Expand tree panel"
            className="flex w-6 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white"
          >
            <ChevronsRight className="h-4 w-4 text-slate-400" />
          </button>
        )}

        <RelationshipGraphCanvas
          nodes={Object.values(state.nodes)}
          edges={Object.values(state.edges)}
          selectedNodeId={state.selectedNodeId}
          visibleIds={visibleIds}
          onSelectNode={handleSelectNode}
          onSelectEdge={(edge) => dispatch({ type: "selectEdge", edgeId: edge.id })}
        />

        {!rightCollapsed ? (
          <div className="flex w-80 shrink-0 flex-col overflow-y-auto rounded-lg border border-slate-200 bg-white">
            <div className="flex items-center justify-end border-b border-slate-200 px-3 py-2">
              <button type="button" onClick={() => setRightCollapsed(true)} aria-label="Collapse detail panel">
                <ChevronsRight className="h-4 w-4 text-slate-400" />
              </button>
            </div>
            <DetailPanel
              state={state}
              organizations={organizations}
              handlers={{
                onSelectNode: handleSelectNode,
                onOpenGrantEntitlement: (organizationId, tenantId) =>
                  setModal({ kind: "grantEntitlement", organizationId, tenantId }),
                onOpenAddTenant: (organizationId) => {
                  const organization = organizations.find((org) => org.id === organizationId);
                  if (organization) {
                    setModal({ kind: "createTenant", organizationId, organizationName: organization.displayName });
                  }
                },
                onOpenAddDataset: (dataProductId) => {
                  const node = state.nodes[dataProductId];
                  setModal({
                    kind: "addDataset",
                    dataProductId,
                    dataProductName: node && "name" in node.data ? node.data.name : dataProductId,
                  });
                },
                onOpenAssociateProduct: (datasetId) => {
                  const node = state.nodes[datasetId];
                  setModal({
                    kind: "associateProduct",
                    datasetId,
                    datasetName: node && "name" in node.data ? node.data.name : datasetId,
                  });
                },
                onDissociateDataset: async (dataProductId, datasetId) => {
                  await dissociateDatasetAction(dataProductId, datasetId);
                  const dataProductNode = state.nodes[dataProductId];
                  if (dataProductNode) await handleRefreshNode(dataProductNode);
                },
                onRefreshNode: handleRefreshNode,
              }}
            />
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setRightCollapsed(false)}
            aria-label="Expand detail panel"
            className="flex w-6 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white"
          >
            <ChevronsLeft className="h-4 w-4 text-slate-400" />
          </button>
        )}
      </div>

      <Modal open={modal.kind === "createOrganization"} onClose={() => setModal({ kind: null })} title="Create Organization">
        <CreateOrganizationForm />
      </Modal>
      <Modal open={modal.kind === "createDataProduct"} onClose={() => setModal({ kind: null })} title="Create Data Product">
        <CreateDataProductForm />
      </Modal>

      {modal.kind === "createDataset" ? (
        <CreateDatasetModal open onClose={() => setModal({ kind: null })} onCreated={() => {}} />
      ) : null}

      {modal.kind === "createTenant" ? (
        <CreateTenantModal
          open
          onClose={() => setModal({ kind: null })}
          organizationId={modal.organizationId}
          organizationName={modal.organizationName}
          onCreated={() => {
            const orgNode = state.nodes[modal.organizationId];
            if (orgNode) handleRefreshNode(orgNode);
          }}
        />
      ) : null}

      {modal.kind === "grantEntitlement" ? (
        <GrantEntitlementModal
          open
          onClose={() => setModal({ kind: null })}
          organizations={organizations}
          dataProducts={dataProducts}
          loadTenants={loadTenants}
          defaultOrganizationId={modal.organizationId}
          defaultTenantId={modal.tenantId}
          onGranted={(tenantId) => {
            const tenantNode = state.nodes[tenantId];
            if (tenantNode) handleRefreshNode(tenantNode);
          }}
        />
      ) : null}

      {modal.kind === "addDataset" ? (
        <AddDatasetModal
          open
          onClose={() => setModal({ kind: null })}
          dataProductId={modal.dataProductId}
          dataProductName={modal.dataProductName}
          datasets={datasets}
          alreadyAssociatedIds={associatedDatasetIdsForProduct(modal.dataProductId)}
          onAssociated={() => {
            const node = state.nodes[modal.dataProductId];
            if (node) handleRefreshNode(node);
          }}
        />
      ) : null}

      {modal.kind === "associateProduct" ? (
        <AssociateProductModal
          open
          onClose={() => setModal({ kind: null })}
          datasetId={modal.datasetId}
          datasetName={modal.datasetName}
          dataProducts={dataProducts}
          alreadyAssociatedIds={associatedProductIdsForDataset(modal.datasetId)}
          onAssociated={() => {
            const node = state.nodes[modal.datasetId];
            if (node) handleRefreshNode(node);
          }}
        />
      ) : null}
    </div>
  );
}
