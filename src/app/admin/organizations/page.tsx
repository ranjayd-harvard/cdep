import Link from "next/link";
import { requireSuperuserContext } from "@/lib/admin";
import { services } from "@/services";
import { listPortalUsersByOrganization } from "@/lib/user-directory";
import {
  PageHeader,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableHeaderCell,
  TableCell,
  StatusBadge,
  Button,
} from "@/components/ui";
import { setOrganizationStatus } from "./actions";
import { CreateOrganizationForm } from "./create-organization-form";

export default async function AdminOrganizationsPage() {
  await requireSuperuserContext();

  const organizations = await services.organizations.listOrganizations();
  const rows = await Promise.all(
    organizations.map(async (organization) => {
      const [tenants, members] = await Promise.all([
        services.tenants.listTenants(organization.id),
        listPortalUsersByOrganization(organization.id),
      ]);
      return { organization, tenantCount: tenants.length, memberCount: members.length };
    }),
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Organizations" description="Every customer on the platform." />

      <Card>
        <CardHeader>
          <CardTitle>Create Organization</CardTitle>
        </CardHeader>
        <CardContent>
          <CreateOrganizationForm />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>Name</TableHeaderCell>
                <TableHeaderCell>ID</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
                <TableHeaderCell>Tenants</TableHeaderCell>
                <TableHeaderCell>Members</TableHeaderCell>
                <TableHeaderCell>Actions</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map(({ organization, tenantCount, memberCount }) => (
                <TableRow key={organization.id}>
                  <TableCell>
                    <Link href={`/admin/organizations/${organization.id}`} className="font-medium text-slate-900 hover:underline">
                      {organization.displayName}
                    </Link>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{organization.id}</TableCell>
                  <TableCell>
                    <StatusBadge status={organization.status} />
                  </TableCell>
                  <TableCell>{tenantCount}</TableCell>
                  <TableCell>{memberCount}</TableCell>
                  <TableCell>
                    <form action={setOrganizationStatus.bind(null, organization.id, organization.status === "active" ? "inactive" : "active")}>
                      <Button type="submit" size="sm" variant="secondary">
                        {organization.status === "active" ? "Deactivate" : "Activate"}
                      </Button>
                    </form>
                  </TableCell>
                </TableRow>
              ))}
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-slate-500">
                    No organizations yet.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
