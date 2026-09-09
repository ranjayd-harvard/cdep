import type { DataProduct, Dataset } from "@/models";
import type { GraphEdge, GraphNode, GraphNodeType, RelationshipGraph } from "@/lib/relationship-graph";

export interface ExplorerState {
  nodes: Record<string, GraphNode>;
  edges: Record<string, GraphEdge>;
  /** Node ids that have had `expand()` called on them (tracked so the tree/graph can show a collapse affordance). */
  expanded: Record<string, true>;
  /** For an expanded node, the ids of every other node its last expand call introduced. */
  childrenOf: Record<string, string[]>;
  selectedNodeId: string | null;
  selectedEdgeId: string | null;
}

export function createInitialState(rootNodes: GraphNode[]): ExplorerState {
  const nodes: Record<string, GraphNode> = {};
  for (const node of rootNodes) {
    nodes[node.id] = node;
  }
  return { nodes, edges: {}, expanded: {}, childrenOf: {}, selectedNodeId: null, selectedEdgeId: null };
}

export type ExplorerAction =
  | { type: "merge"; graph: RelationshipGraph; parentId?: string }
  | { type: "collapse"; nodeId: string }
  | { type: "selectNode"; nodeId: string }
  | { type: "selectEdge"; edgeId: string }
  | { type: "clearSelection" };

function mergeGraph(state: ExplorerState, graph: RelationshipGraph, parentId?: string): ExplorerState {
  const nodes = { ...state.nodes };
  for (const node of graph.nodes) {
    nodes[node.id] = node;
  }
  const edges = { ...state.edges };
  for (const edge of graph.edges) {
    edges[edge.id] = edge;
  }

  if (!parentId) {
    return { ...state, nodes, edges };
  }

  const childIds = graph.nodes.map((node) => node.id).filter((id) => id !== parentId);
  return {
    ...state,
    nodes,
    edges,
    expanded: { ...state.expanded, [parentId]: true },
    childrenOf: { ...state.childrenOf, [parentId]: childIds },
  };
}

function collapseNode(state: ExplorerState, nodeId: string): ExplorerState {
  if (!state.expanded[nodeId]) {
    return state;
  }

  let next = state;
  const directChildren = next.childrenOf[nodeId] ?? [];
  for (const childId of directChildren) {
    if (next.expanded[childId]) {
      next = collapseNode(next, childId);
    }
  }

  const stillReferenced = new Set<string>();
  for (const [otherId, children] of Object.entries(next.childrenOf)) {
    if (otherId === nodeId) continue;
    for (const childId of children) stillReferenced.add(childId);
  }
  const toRemove = new Set((next.childrenOf[nodeId] ?? []).filter((id) => !stillReferenced.has(id)));

  const nodes = { ...next.nodes };
  for (const id of toRemove) delete nodes[id];

  const edges = { ...next.edges };
  for (const [edgeId, edge] of Object.entries(edges)) {
    if (toRemove.has(edge.source) || toRemove.has(edge.target)) delete edges[edgeId];
  }

  const expanded = { ...next.expanded };
  delete expanded[nodeId];
  const childrenOf = { ...next.childrenOf };
  delete childrenOf[nodeId];

  return {
    ...next,
    nodes,
    edges,
    expanded,
    childrenOf,
    selectedNodeId: next.selectedNodeId && toRemove.has(next.selectedNodeId) ? nodeId : next.selectedNodeId,
  };
}

export function explorerReducer(state: ExplorerState, action: ExplorerAction): ExplorerState {
  switch (action.type) {
    case "merge":
      return mergeGraph(state, action.graph, action.parentId);
    case "collapse":
      return collapseNode(state, action.nodeId);
    case "selectNode":
      return { ...state, selectedNodeId: action.nodeId, selectedEdgeId: null };
    case "selectEdge":
      return { ...state, selectedNodeId: null, selectedEdgeId: action.edgeId };
    case "clearSelection":
      return { ...state, selectedNodeId: null, selectedEdgeId: null };
    default:
      return state;
  }
}

export const PARAM_BY_TYPE: Record<GraphNodeType, string> = {
  organization: "organizationId",
  tenant: "tenantId",
  dataProduct: "dataProductId",
  dataset: "datasetId",
};

export async function fetchExpand(type: GraphNodeType, id: string): Promise<RelationshipGraph> {
  const param = PARAM_BY_TYPE[type];
  const response = await fetch(`/api/admin/data-relationships?${param}=${encodeURIComponent(id)}`);
  if (!response.ok) {
    throw new Error("Failed to load relationships.");
  }
  return response.json();
}

export async function fetchSearch(query: string): Promise<RelationshipGraph> {
  const response = await fetch(`/api/admin/data-relationships?search=${encodeURIComponent(query)}`);
  if (!response.ok) {
    throw new Error("Search failed.");
  }
  return response.json();
}

export type RelationshipScope = "all" | "upstream" | "downstream" | "direct";

/**
 * Computes the visible node id set for a scope filter relative to the
 * selected node. "Upstream" follows edges backwards (source <- target,
 * e.g. Dataset -> Data Product -> Tenant -> Organization); "downstream"
 * follows them forwards; "direct" is just the selected node's immediate
 * neighbors.
 */
export function scopedNodeIds(
  state: ExplorerState,
  scope: RelationshipScope,
  selectedId: string | null,
): Set<string> | null {
  if (scope === "all" || !selectedId || !state.nodes[selectedId]) {
    return null;
  }

  const edges = Object.values(state.edges);
  if (scope === "direct") {
    const ids = new Set<string>([selectedId]);
    for (const edge of edges) {
      if (edge.source === selectedId) ids.add(edge.target);
      if (edge.target === selectedId) ids.add(edge.source);
    }
    return ids;
  }

  const ids = new Set<string>([selectedId]);
  const frontier = [selectedId];
  while (frontier.length > 0) {
    const current = frontier.pop()!;
    for (const edge of edges) {
      if (scope === "downstream" && edge.source === current && !ids.has(edge.target)) {
        ids.add(edge.target);
        frontier.push(edge.target);
      }
      if (scope === "upstream" && edge.target === current && !ids.has(edge.source)) {
        ids.add(edge.source);
        frontier.push(edge.source);
      }
    }
  }
  return ids;
}

export interface CatalogRefs {
  dataProducts: DataProduct[];
  datasets: Dataset[];
}
