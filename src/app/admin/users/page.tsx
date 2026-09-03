import { requireSuperuserContext } from "@/lib/admin";
import { services } from "@/services";
import { listAllPortalUsers } from "@/lib/user-directory";
import { PageHeader, Card, CardContent } from "@/components/ui";
import { AdminUsersTable, type AdminUserRow } from "./users-table";

export default async function AdminUsersPage() {
  const admin = await requireSuperuserContext();

  const [users, organizations] = await Promise.all([listAllPortalUsers(), services.organizations.listOrganizations()]);
  const orgNameById = new Map(organizations.map((org) => [org.id, org.displayName]));

  const rows: AdminUserRow[] = users
    .map((user) => ({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      status: user.status,
      organizationId: user.organizationId,
      organizationName: user.organizationId ? orgNameById.get(user.organizationId) ?? "Unknown" : null,
      tenantId: user.tenantId,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Users" description="Every account on the platform, across every organization." />

      <Card>
        <CardContent className="p-0">
          <AdminUsersTable users={rows} currentUserId={admin.userId} />
        </CardContent>
      </Card>
    </div>
  );
}
