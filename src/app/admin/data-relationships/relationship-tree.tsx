"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ExplorerState } from "./graph-state";
import type { GraphNode } from "@/lib/relationship-graph";

export interface RelationshipTreeProps {
  state: ExplorerState;
  onSelect: (node: GraphNode) => void;
  onToggleCollapse: (nodeId: string) => void;
}

function childrenOfType(
  state: ExplorerState,
  parentId: string,
  edgeMatchesSourceParent: boolean,
): GraphNode[] {
  const ids: string[] = [];
  for (const edge of Object.values(state.edges)) {
    if (edgeMatchesSourceParent && edge.source === parentId) ids.push(edge.target);
    if (!edgeMatchesSourceParent && edge.target === parentId) ids.push(edge.source);
  }
  return ids.map((id) => state.nodes[id]).filter((node): node is GraphNode => Boolean(node));
}

export function RelationshipTree({ state, onSelect, onToggleCollapse }: RelationshipTreeProps) {
  const organizations = Object.values(state.nodes).filter((node) => node.type === "organization");

  if (organizations.length === 0) {
    return <p className="p-4 text-sm text-slate-500">No organizations yet.</p>;
  }

  return (
    <div className="flex flex-col overflow-y-auto py-1 text-sm">
      {organizations.map((org) => (
        <TreeRow key={org.id} node={org} depth={0} state={state} onSelect={onSelect} onToggleCollapse={onToggleCollapse} />
      ))}
    </div>
  );
}

function TreeRow({
  node,
  depth,
  state,
  onSelect,
  onToggleCollapse,
}: {
  node: GraphNode;
  depth: number;
  state: ExplorerState;
  onSelect: (node: GraphNode) => void;
  onToggleCollapse: (nodeId: string) => void;
}) {
  const expanded = Boolean(state.expanded[node.id]);
  const canExpand = node.type !== "dataset";
  const selected = state.selectedNodeId === node.id;

  const children = expanded
    ? node.type === "dataset"
      ? []
      : childrenOfType(state, node.id, true)
    : [];

  return (
    <div>
      <button
        type="button"
        onClick={() => onSelect(node)}
        className={cn(
          "flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left hover:bg-slate-100",
          selected && "bg-slate-900/5 font-medium text-slate-900",
        )}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        {canExpand ? (
          <span
            role="button"
            tabIndex={-1}
            onClick={(event) => {
              event.stopPropagation();
              onToggleCollapse(node.id);
            }}
            className="flex h-4 w-4 shrink-0 items-center justify-center text-slate-400 hover:text-slate-700"
          >
            {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </span>
        ) : (
          <span className="w-4 shrink-0" />
        )}
        <span className="truncate text-slate-700">
          {"name" in node.data ? node.data.name : node.id}
        </span>
      </button>
      {children.map((child) => (
        <TreeRow
          key={child.id}
          node={child}
          depth={depth + 1}
          state={state}
          onSelect={onSelect}
          onToggleCollapse={onToggleCollapse}
        />
      ))}
    </div>
  );
}
