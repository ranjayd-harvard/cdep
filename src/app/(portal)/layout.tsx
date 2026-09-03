import type { ReactNode } from "react";
import { requireTenantContext } from "@/lib/tenant";
import { services } from "@/services";
import { PortalShell } from "@/components/layout/portal-shell";

export default async function PortalLayout({ children }: { children: ReactNode }) {
  const tenant = await requireTenantContext();
  const organization = await services.organizations.getOrganization(tenant.organizationId);

  return (
    <PortalShell
      organizationName={organization?.displayName ?? "Unknown Organization"}
      user={{ name: tenant.name, email: tenant.email, role: tenant.role }}
    >
      {children}
    </PortalShell>
  );
}
