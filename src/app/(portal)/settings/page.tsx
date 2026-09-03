import { requireTenantContext } from "@/lib/tenant";
import { canManageSettings } from "@/lib/authorization";
import { listPortalUsersByOrganization } from "@/lib/user-directory";
import { services } from "@/services";
import { PageHeader, Card, CardHeader, CardTitle, CardContent, StatusBadge, Badge, Button, Select } from "@/components/ui";
import { formatRole } from "@/lib/format-role";
import { formatDateTime } from "@/lib/utils";
import { NotificationPreferences } from "./notification-preferences";
import { CreateTenantForm } from "./create-tenant-form";
import { approveMembershipRequest, rejectMembershipRequest } from "./membership-actions";
import { setDefaultTenant, switchMyTenant } from "./tenant-actions";
import { reassignMemberTenant } from "./member-actions";
import { revokeInvitation } from "./invitation-actions";
import { InviteForm } from "./invite-form";
import { UserHierarchy } from "./user-hierarchy";

export default async function SettingsPage() {
  const tenant = await requireTenantContext();
  const isAdmin = canManageSettings(tenant.role);

  const [organization, tenants, pendingRequests, members, pendingInvitations] = await Promise.all([
    services.organizations.getOrganization(tenant.organizationId),
    services.tenants.listTenants(tenant.organizationId),
    isAdmin ? services.organizationMemberships.listPendingRequests(tenant.organizationId) : Promise.resolve([]),
    isAdmin ? listPortalUsersByOrganization(tenant.organizationId) : Promise.resolve([]),
    isAdmin ? services.organizationInvitations.listPendingInvitations(tenant.organizationId) : Promise.resolve([]),
  ]);
  const userTenant = tenants.find((t) => t.id === tenant.tenantId) ?? null;
  const tenantOptions = tenants.map((t) => ({ label: `${t.displayName}${t.isDefault ? " (Default)" : ""}`, value: t.id }));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Settings"
        description="Organization, tenants, invitations, profile, and notification preferences."
      />

      <Card>
        <CardHeader>
          <CardTitle>Organization</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">Organization Name</dt>
              <dd className="mt-0.5 text-sm font-medium text-slate-900">
                {organization?.displayName ?? "Unknown"}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">Organization ID</dt>
              <dd className="mt-0.5 font-mono text-xs text-slate-700">{organization?.id ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">Status</dt>
              <dd className="mt-0.5">
                <StatusBadge status={organization?.status ?? "inactive"} />
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Tenants</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <ul className="divide-y divide-slate-100">
            {tenants.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-3 py-2">
                <div>
                  <p className="text-sm font-medium text-slate-900">{t.displayName}</p>
                  <p className="font-mono text-xs text-slate-500">{t.id}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {t.isDefault ? (
                    <Badge color="blue">Default</Badge>
                  ) : isAdmin && tenants.length > 1 ? (
                    <form action={setDefaultTenant.bind(null, t.id)}>
                      <Button type="submit" size="sm" variant="secondary">
                        Make default
                      </Button>
                    </form>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>

          {isAdmin ? <CreateTenantForm /> : null}
        </CardContent>
      </Card>

      {isAdmin ? (
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
                      <form action={approveMembershipRequest.bind(null, request.id)}>
                        <Button type="submit" size="sm">
                          Approve
                        </Button>
                      </form>
                      <form action={rejectMembershipRequest.bind(null, request.id)}>
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
      ) : null}

      {isAdmin ? (
        <Card>
          <CardHeader>
            <CardTitle>Invitations</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {pendingInvitations.length === 0 ? (
              <p className="text-sm text-slate-500">No pending invitations.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {pendingInvitations.map((invite) => (
                  <li key={invite.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <div>
                      <p className="text-sm font-medium text-slate-900">{invite.email}</p>
                      <p className="text-xs text-slate-500">
                        {formatRole(invite.role)}
                        {tenants.length > 1
                          ? ` · ${tenants.find((t) => t.id === invite.tenantId)?.displayName ?? "Unknown tenant"}`
                          : ""}
                      </p>
                      <p className="text-xs text-slate-400">Invited {formatDateTime(invite.invitedAt.toISOString())}</p>
                    </div>
                    <form action={revokeInvitation.bind(null, invite.id)}>
                      <Button type="submit" size="sm" variant="secondary">
                        Revoke
                      </Button>
                    </form>
                  </li>
                ))}
              </ul>
            )}

            <InviteForm tenantOptions={tenantOptions} />
          </CardContent>
        </Card>
      ) : null}

      {isAdmin ? (
        <Card>
          <CardHeader>
            <CardTitle>Members</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-slate-100">
              {members.map((member) => {
                const memberTenant = tenants.find((t) => t.id === member.tenantId);
                return (
                  <li key={member.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <div>
                      <p className="text-sm font-medium text-slate-900">{member.name}</p>
                      <p className="text-xs text-slate-500">{member.email}</p>
                      <p className="text-xs text-slate-400">{member.role ? formatRole(member.role) : "—"}</p>
                    </div>
                    {tenants.length > 1 ? (
                      <form
                        action={reassignMemberTenant.bind(null, member.id)}
                        className="flex shrink-0 items-center gap-2"
                      >
                        <Select
                          name="tenantId"
                          options={tenantOptions}
                          defaultValue={member.tenantId ?? undefined}
                          className="py-1.5 text-xs"
                        />
                        <Button type="submit" size="sm" variant="secondary">
                          Move
                        </Button>
                      </form>
                    ) : (
                      <p className="text-xs text-slate-500">{memberTenant?.displayName ?? "—"}</p>
                    )}
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      <Card id="access-hierarchy" className="scroll-mt-20">
        <CardHeader>
          <CardTitle>User Profile</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">Name</dt>
              <dd className="mt-0.5 text-sm font-medium text-slate-900">{tenant.name}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">Email</dt>
              <dd className="mt-0.5 text-sm text-slate-700">{tenant.email}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">Role</dt>
              <dd className="mt-0.5 text-sm text-slate-700">{formatRole(tenant.role)}</dd>
            </div>
          </dl>

          <div>
            <h4 className="mb-3 text-xs font-medium uppercase tracking-wide text-slate-400">
              Your Access Hierarchy
            </h4>
            <UserHierarchy
              organization={organization}
              tenant={userTenant}
              user={{ name: tenant.name, email: tenant.email, role: tenant.role }}
            />

            {tenants.length > 1 ? (
              <form action={switchMyTenant} className="mt-4 ml-11 flex items-center gap-2">
                <Select name="tenantId" options={tenantOptions} defaultValue={tenant.tenantId} className="py-1.5 text-xs" />
                <Button type="submit" size="sm" variant="secondary">
                  Switch my tenant
                </Button>
              </form>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Notification Preferences</CardTitle>
        </CardHeader>
        <CardContent>
          <NotificationPreferences />
        </CardContent>
      </Card>
    </div>
  );
}
