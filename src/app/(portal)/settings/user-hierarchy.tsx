import type { ReactNode } from "react";
import { Building2, Layers, UserRound, type LucideIcon } from "lucide-react";
import type { Organization, Tenant, UserRole } from "@/models";
import { Badge, StatusBadge } from "@/components/ui";
import { formatRole } from "@/lib/format-role";

interface UserHierarchyProps {
  organization: Organization | null;
  tenant: Tenant | null;
  user: { name: string; email: string; role: UserRole };
}

interface NodeProps {
  icon: LucideIcon;
  eyebrow: string;
  title: string;
  subtitle?: string;
  trailing?: ReactNode;
}

function HierarchyNode({ icon: Icon, eyebrow, title, subtitle, trailing }: NodeProps) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-slate-100">
        <Icon className="h-4 w-4 text-slate-500" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{eyebrow}</p>
        <div className="mt-0.5 flex flex-wrap items-center gap-2">
          <p className="truncate text-sm font-semibold text-slate-900">{title}</p>
          {trailing}
        </div>
        {subtitle ? <p className="mt-0.5 truncate font-mono text-xs text-slate-500">{subtitle}</p> : null}
      </div>
    </div>
  );
}

/**
 * Renders this account's actual chain of custody — Organization -> Tenant ->
 * User — the same three-entity relationship documented in
 * docs/user-org-tenant-model.md, but for the signed-in user specifically
 * rather than the org's full tenant list (see the "Tenants" card above,
 * which lists every tenant in the org; this shows only the one the caller
 * is assigned to).
 */
export function UserHierarchy({ organization, tenant, user }: UserHierarchyProps) {
  return (
    <div className="flex flex-col gap-3">
      <HierarchyNode
        icon={Building2}
        eyebrow="Organization"
        title={organization?.displayName ?? "Unknown Organization"}
        subtitle={organization?.id}
        trailing={<StatusBadge status={organization?.status ?? "inactive"} />}
      />

      <div className="ml-4 border-l-2 border-slate-200 pl-4">
        <HierarchyNode
          icon={Layers}
          eyebrow="Tenant"
          title={tenant?.displayName ?? "Unknown Tenant"}
          subtitle={tenant?.id}
          trailing={tenant?.isDefault ? <Badge color="blue">Default</Badge> : null}
        />

        <div className="mt-3 ml-4 border-l-2 border-slate-200 pl-4">
          <HierarchyNode
            icon={UserRound}
            eyebrow="You"
            title={user.name}
            subtitle={user.email}
            trailing={<Badge color="gray">{formatRole(user.role)}</Badge>}
          />
        </div>
      </div>
    </div>
  );
}
