import { notFound } from "next/navigation";
import { requireSuperuserContext } from "@/lib/admin";
import { services } from "@/services";
import { listPortalUsersByOrganization } from "@/lib/user-directory";
import { UserRole, PortalUserStatus } from "@/models";
import { formatRole } from "@/lib/format-role";
import { formatDateTime } from "@/lib/utils";
import {
  PageHeader,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  StatusBadge,
  Select,
  Button,
} from "@/components/ui";
import {
  setTenantStatus,
  setMemberRoleFromForm,
  setMemberStatus,
  approveMembershipRequest,
  rejectMembershipRequest,
  revokeInvitation,
} from "./actions";

const MEMBER_ROLE_OPTIONS = [
  { label: formatRole(UserRole.CUSTOMER_ADMIN), value: UserRole.CUSTOMER_ADMIN },
  { label: formatRole(UserRole.CUSTOMER_USER), value: UserRole.CUSTOMER_USER },
  { label: formatRole(UserRole.CUSTOMER_READONLY), value: UserRole.CUSTOMER_READONLY },
];

export default async function AdminOrganizationDetailPage({
  params,
}: {
  params: Promise<{ organizationId: string }>;
}) {
  await requireSuperuserContext();
  const { organizationId } = await params;

  const organization = await services.organizations.getOrganization(organizationId);
  if (!organization) {
    notFound();
  }

  const [tenants, members, pendingRequests, pendingInvitations] = await Promise.all([
    services.tenants.listTenants(organizationId),
    listPortalUsersByOrganization(organizationId),
    services.organizationMemberships.listPendingRequests(organizationId),
    services.organizationInvitations.listPendingInvitations(organizationId),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={organization.displayName} description={organization.id} />

      <Card>
        <CardHeader>
          <CardTitle>Organization</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">Name</dt>
              <dd className="mt-0.5 text-sm font-medium text-slate-900">{organization.displayName}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">Status</dt>
              <dd className="mt-0.5">
                <StatusBadge status={organization.status} />
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">ID</dt>
              <dd className="mt-0.5 font-mono text-xs text-slate-700">{organization.id}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Tenants</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="divide-y divide-slate-100">
            {tenants.map((tenant) => (
              <li key={tenant.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div>
                  <p className="text-sm font-medium text-slate-900">
                    {tenant.displayName}
                    {tenant.isDefault ? <span className="ml-2 text-xs text-slate-400">(Default)</span> : null}
                  </p>
                  <p className="font-mono text-xs text-slate-500">{tenant.id}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <StatusBadge status={tenant.status} />
                  <form
                    action={setTenantStatus.bind(
                      null,
                      organizationId,
                      tenant.id,
                      tenant.status === "active" ? "inactive" : "active",
                    )}
                  >
                    <Button type="submit" size="sm" variant="secondary">
                      {tenant.status === "active" ? "Deactivate" : "Activate"}
                    </Button>
                  </form>
                </div>
              </li>
            ))}
            {tenants.length === 0 ? <p className="py-3 text-sm text-slate-500">No tenants.</p> : null}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Members</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="divide-y divide-slate-100">
            {members.map((member) => (
              <li key={member.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div>
                  <p className="text-sm font-medium text-slate-900">{member.name}</p>
                  <p className="text-xs text-slate-500">{member.email}</p>
                  <p className="text-xs text-slate-400">
                    {member.status === PortalUserStatus.SUSPENDED ? "Suspended" : "Active"}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  <form
                    action={setMemberRoleFromForm.bind(null, organizationId, member.id)}
                    className="flex items-center gap-2"
                  >
                    <Select name="role" options={MEMBER_ROLE_OPTIONS} defaultValue={member.role ?? undefined} className="py-1.5 text-xs" />
                    <Button type="submit" size="sm" variant="secondary">
                      Save
                    </Button>
                  </form>
                  <form
                    action={setMemberStatus.bind(
                      null,
                      organizationId,
                      member.id,
                      member.status === PortalUserStatus.SUSPENDED ? PortalUserStatus.ACTIVE : PortalUserStatus.SUSPENDED,
                    )}
                  >
                    <Button type="submit" size="sm" variant={member.status === PortalUserStatus.SUSPENDED ? "secondary" : "danger"}>
                      {member.status === PortalUserStatus.SUSPENDED ? "Reactivate" : "Suspend"}
                    </Button>
                  </form>
                </div>
              </li>
            ))}
            {members.length === 0 ? <p className="py-3 text-sm text-slate-500">No members.</p> : null}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Pending Membership Requests</CardTitle>
        </CardHeader>
        <CardContent>
          {pendingRequests.length === 0 ? (
            <p className="text-sm text-slate-500">No pending requests.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {pendingRequests.map((request) => (
                <li key={request.id} className="flex items-center justify-between gap-3 py-3">
                  <div>
                    <p className="text-sm font-medium text-slate-900">{request.userName}</p>
                    <p className="text-xs text-slate-500">{request.userEmail}</p>
                    <p className="text-xs text-slate-400">
                      Requested {formatDateTime(request.requestedAt.toISOString())}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <form action={approveMembershipRequest.bind(null, organizationId, request.id)}>
                      <Button type="submit" size="sm">
                        Approve
                      </Button>
                    </form>
                    <form action={rejectMembershipRequest.bind(null, organizationId, request.id)}>
                      <Button type="submit" size="sm" variant="secondary">
                        Reject
                      </Button>
                    </form>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Pending Invitations</CardTitle>
        </CardHeader>
        <CardContent>
          {pendingInvitations.length === 0 ? (
            <p className="text-sm text-slate-500">No pending invitations.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {pendingInvitations.map((invite) => (
                <li key={invite.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div>
                    <p className="text-sm font-medium text-slate-900">{invite.email}</p>
                    <p className="text-xs text-slate-500">{formatRole(invite.role)}</p>
                    <p className="text-xs text-slate-400">Invited {formatDateTime(invite.invitedAt.toISOString())}</p>
                  </div>
                  <form action={revokeInvitation.bind(null, organizationId, invite.id)}>
                    <Button type="submit" size="sm" variant="secondary">
                      Revoke
                    </Button>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
