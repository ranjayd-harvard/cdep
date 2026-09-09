"use client";

import { useMemo, useState } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  type Edge,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Maximize2, Minimize2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui";
import { cn } from "@/lib/utils";
import type { GraphEdge, GraphNode, GraphNodeType } from "@/lib/relationship-graph";
import { NODE_TYPES } from "./graph-nodes";

const LAYER_ORDER: GraphNodeType[] = ["organization", "tenant", "dataProduct", "dataset"];
const LAYER_HEIGHT = 160;
const NODE_WIDTH = 232;

function layoutNodes(nodes: GraphNode[]): Record<string, { x: number; y: number }> {
  const positions: Record<string, { x: number; y: number }> = {};
  for (const layerType of LAYER_ORDER) {
    const layerNodes = nodes.filter((node) => node.type === layerType).sort((a, b) => a.id.localeCompare(b.id));
    const layerIndex = LAYER_ORDER.indexOf(layerType);
    layerNodes.forEach((node, index) => {
      positions[node.id] = { x: index * NODE_WIDTH, y: layerIndex * LAYER_HEIGHT };
    });
  }
  return positions;
}

const ENTITLEMENT_COLOR: Record<string, string> = {
  ACTIVE: "#059669",
  REVOKED: "#dc2626",
  EXPIRED: "#94a3b8",
};

function toFlowEdge(edge: GraphEdge, dimmed: boolean): Edge {
  const isEntitlement = edge.type === "ENTITLED";
  const status = edge.data?.status;
  const dashed = isEntitlement && status !== "ACTIVE";
  const color = isEntitlement ? (ENTITLEMENT_COLOR[status ?? ""] ?? "#94a3b8") : "#94a3b8";

  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    type: "smoothstep",
    label: isEntitlement ? status : undefined,
    labelStyle: { fill: color, fontSize: 10, fontWeight: 600 },
    labelBgStyle: { fill: "white", fillOpacity: 0.9 },
    style: {
      stroke: color,
      strokeWidth: 2,
      strokeDasharray: dashed ? "6 4" : undefined,
      opacity: dimmed ? 0.12 : 1,
    },
  };
}

export interface RelationshipGraphCanvasProps {
  nodes: GraphNode[];
  edges: GraphEdge[];
  selectedNodeId: string | null;
  visibleIds: Set<string> | null;
  onSelectNode: (node: GraphNode) => void;
  onSelectEdge: (edge: GraphEdge) => void;
}

export function RelationshipGraphCanvas(props: RelationshipGraphCanvasProps) {
  const [fullscreen, setFullscreen] = useState(false);
  const [layoutVersion, setLayoutVersion] = useState(0);

  return (
    <div
      className={cn(
        "relative flex-1 rounded-lg border border-slate-200 bg-slate-50",
        fullscreen && "fixed inset-4 z-50 shadow-2xl",
      )}
    >
      <div className="absolute right-3 top-3 z-10 flex gap-2">
        <Button type="button" size="sm" variant="secondary" onClick={() => setLayoutVersion((v) => v + 1)}>
          <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
          Reset layout
        </Button>
        <Button type="button" size="sm" variant="secondary" onClick={() => setFullscreen((v) => !v)}>
          {fullscreen ? <Minimize2 className="h-3.5 w-3.5" aria-hidden="true" /> : <Maximize2 className="h-3.5 w-3.5" aria-hidden="true" />}
        </Button>
      </div>
      <ReactFlowProvider>
        <GraphCanvasInner {...props} layoutVersion={layoutVersion} />
      </ReactFlowProvider>
    </div>
  );
}

function GraphCanvasInner({
  nodes,
  edges,
  selectedNodeId,
  visibleIds,
  onSelectNode,
  onSelectEdge,
  layoutVersion,
}: RelationshipGraphCanvasProps & { layoutVersion: number }) {
  const visibleNodes = useMemo(
    () => (visibleIds ? nodes.filter((node) => visibleIds.has(node.id)) : nodes),
    [nodes, visibleIds],
  );
  const visibleNodeIds = useMemo(() => new Set(visibleNodes.map((node) => node.id)), [visibleNodes]);
  const visibleEdges = useMemo(
    () => edges.filter((edge) => visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target)),
    [edges, visibleNodeIds],
  );

  const neighborIds = useMemo(() => {
    if (!selectedNodeId) return null;
    const ids = new Set<string>([selectedNodeId]);
    for (const edge of visibleEdges) {
      if (edge.source === selectedNodeId) ids.add(edge.target);
      if (edge.target === selectedNodeId) ids.add(edge.source);
    }
    return ids;
  }, [selectedNodeId, visibleEdges]);

  // eslint-disable-next-line react-hooks/exhaustive-deps -- layoutVersion intentionally forces a fresh layout
  const positions = useMemo(() => layoutNodes(visibleNodes), [visibleNodes, layoutVersion]);

  const flowNodes: Node[] = visibleNodes.map((node) => ({
    id: node.id,
    type: node.type,
    position: positions[node.id] ?? { x: 0, y: 0 },
    selected: node.id === selectedNodeId,
    data: { ...node.data, dimmed: neighborIds ? !neighborIds.has(node.id) : false },
    draggable: true,
  }));

  const flowEdges: Edge[] = visibleEdges.map((edge) =>
    toFlowEdge(edge, neighborIds ? !(neighborIds.has(edge.source) && neighborIds.has(edge.target)) : false),
  );

  const nodesById = useMemo(() => new Map(visibleNodes.map((node) => [node.id, node])), [visibleNodes]);
  const edgesById = useMemo(() => new Map(visibleEdges.map((edge) => [edge.id, edge])), [visibleEdges]);

  return (
    <ReactFlow
      nodes={flowNodes}
      edges={flowEdges}
      nodeTypes={NODE_TYPES}
      onNodeClick={(_event, node) => {
        const graphNode = nodesById.get(node.id);
        if (graphNode) onSelectNode(graphNode);
      }}
      onEdgeClick={(_event, edge) => {
        const graphEdge = edgesById.get(edge.id);
        if (graphEdge) onSelectEdge(graphEdge);
      }}
      fitView
      fitViewOptions={{ padding: 0.3 }}
      minZoom={0.2}
      maxZoom={2}
    >
      <Background gap={24} />
      <Controls showInteractive={false} />
    </ReactFlow>
  );
}
