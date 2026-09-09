"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Building2, Database, Layers, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  DataProductNodeData,
  DatasetNodeData,
  OrganizationNodeData,
  TenantNodeData,
} from "@/lib/relationship-graph";

interface CardProps {
  icon: typeof Building2;
  label: string;
  title: string;
  subtitle: string;
  meta?: string;
  accent: string;
  selected?: boolean;
  dimmed?: boolean;
  handles?: { target?: boolean; source?: boolean };
}

function NodeCard({ icon: Icon, label, title, subtitle, meta, accent, selected, dimmed, handles }: CardProps) {
  return (
    <div
      className={cn(
        "w-52 rounded-lg border-2 bg-white p-3 shadow-sm transition-opacity",
        accent,
        selected && "ring-2 ring-offset-2 ring-slate-900",
        dimmed && "opacity-20",
      )}
    >
      {handles?.target !== false ? <Handle type="target" position={Position.Top} className="!bg-slate-400" /> : null}
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
        <Icon className="h-3 w-3" aria-hidden="true" />
        {label}
      </div>
      <p className="mt-1 truncate text-sm font-semibold text-slate-900">{title}</p>
      <p className="truncate text-xs text-slate-500">{subtitle}</p>
      {meta ? <p className="mt-1 text-xs text-slate-400">{meta}</p> : null}
      {handles?.source !== false ? (
        <Handle type="source" position={Position.Bottom} className="!bg-slate-400" />
      ) : null}
    </div>
  );
}

export function OrganizationNode({ data, selected }: NodeProps) {
  const d = data as unknown as OrganizationNodeData & { dimmed?: boolean };
  return (
    <NodeCard
      icon={Building2}
      label="Organization"
      title={d.name}
      subtitle={d.status}
      accent="border-slate-700"
      selected={selected}
      dimmed={d.dimmed}
      handles={{ target: false }}
    />
  );
}

export function TenantNode({ data, selected }: NodeProps) {
  const d = data as unknown as TenantNodeData & { dimmed?: boolean };
  return (
    <NodeCard
      icon={Users}
      label="Tenant"
      title={d.name}
      subtitle={d.status}
      meta={d.isDefault ? "Default tenant" : undefined}
      accent="border-blue-500"
      selected={selected}
      dimmed={d.dimmed}
    />
  );
}

export function DataProductNode({ data, selected }: NodeProps) {
  const d = data as unknown as DataProductNodeData & { dimmed?: boolean };
  return (
    <NodeCard
      icon={Database}
      label="Data Product"
      title={d.name}
      subtitle={d.status}
      meta={d.domain}
      accent="border-purple-500"
      selected={selected}
      dimmed={d.dimmed}
    />
  );
}

export function DatasetNode({ data, selected }: NodeProps) {
  const d = data as unknown as DatasetNodeData & { dimmed?: boolean };
  return (
    <NodeCard
      icon={Layers}
      label="Dataset"
      title={d.name}
      subtitle={`${d.format} · ${d.status}`}
      accent="border-emerald-500"
      selected={selected}
      dimmed={d.dimmed}
      handles={{ source: false }}
    />
  );
}

export const NODE_TYPES = {
  organization: OrganizationNode,
  tenant: TenantNode,
  dataProduct: DataProductNode,
  dataset: DatasetNode,
};
