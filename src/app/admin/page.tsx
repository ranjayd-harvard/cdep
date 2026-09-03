import { Building2, LayoutGrid, Users, UserPlus, Mail } from "lucide-react";
import { requireSuperuserContext } from "@/lib/admin";
import { services } from "@/services";
import { listAllPortalUsers } from "@/lib/user-directory";
import { PageHeader, MetricCard } from "@/components/ui";

export default async function AdminOverviewPage() {
  await requireSuperuserContext();

  const organizations = await services.organizations.listOrganizations();
  const [users, tenantsByOrg, pendingRequestsByOrg, pendingInvitationsByOrg] = await Promise.all([
    listAllPortalUsers(),
    Promise.all(organizations.map((org) => services.tenants.listTenants(org.id))),
    Promise.all(organizations.map((org) => services.organizationMemberships.listPendingRequests(org.id))),
    Promise.all(organizations.map((org) => services.organizationInvitations.listPendingInvitations(org.id))),
  ]);

  const tenantCount = tenantsByOrg.reduce((sum, tenants) => sum + tenants.length, 0);
  const pendingRequestCount = pendingRequestsByOrg.reduce((sum, requests) => sum + requests.length, 0);
  const pendingInvitationCount = pendingInvitationsByOrg.reduce((sum, invites) => sum + invites.length, 0);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Overview" description="Platform-wide status across every customer." />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <MetricCard label="Organizations" value={organizations.length} icon={Building2} />
        <MetricCard label="Tenants" value={tenantCount} icon={LayoutGrid} />
        <MetricCard label="Users" value={users.length} icon={Users} />
        <MetricCard label="Pending Membership Requests" value={pendingRequestCount} icon={UserPlus} tone={pendingRequestCount > 0 ? "warning" : "default"} />
        <MetricCard label="Pending Invitations" value={pendingInvitationCount} icon={Mail} />
      </div>
    </div>
  );
}
