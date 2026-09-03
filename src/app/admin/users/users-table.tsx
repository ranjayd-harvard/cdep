"use client";

import { useMemo, useState } from "react";
import { UserRole, PortalUserStatus } from "@/models";
import { formatRole } from "@/lib/format-role";
import { Table, TableHead, TableBody, TableRow, TableHeaderCell, TableCell, Input, Select, Button, Badge } from "@/components/ui";
import { setUserRoleFromForm, setUserStatus } from "./actions";

export interface AdminUserRow {
  id: string;
  name: string;
  email: string;
  role: UserRole | null;
  status: PortalUserStatus;
  organizationId: string | null;
  organizationName: string | null;
  tenantId: string | null;
}

const ROLE_OPTIONS = [
  { label: formatRole(UserRole.SUPERUSER), value: UserRole.SUPERUSER },
  { label: formatRole(UserRole.CUSTOMER_ADMIN), value: UserRole.CUSTOMER_ADMIN },
  { label: formatRole(UserRole.CUSTOMER_USER), value: UserRole.CUSTOMER_USER },
  { label: formatRole(UserRole.CUSTOMER_READONLY), value: UserRole.CUSTOMER_READONLY },
];

export function AdminUsersTable({ users, currentUserId }: { users: AdminUserRow[]; currentUserId: string }) {
  const [query, setQuery] = useState("");

  const organizationOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const user of users) {
      if (user.organizationId) {
        seen.set(user.organizationId, user.organizationName ?? user.organizationId);
      }
    }
    return [{ label: "All organizations", value: "" }, ...Array.from(seen, ([value, label]) => ({ label, value }))];
  }, [users]);
  const [organizationId, setOrganizationId] = useState("");

  const filtered = users.filter((user) => {
    const matchesOrg = !organizationId || user.organizationId === organizationId;
    const normalizedQuery = query.trim().toLowerCase();
    const matchesQuery =
      !normalizedQuery || user.name.toLowerCase().includes(normalizedQuery) || user.email.toLowerCase().includes(normalizedQuery);
    return matchesOrg && matchesQuery;
  });

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Input
          placeholder="Search by name or email"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="sm:max-w-xs"
        />
        <Select
          options={organizationOptions}
          value={organizationId}
          onChange={(event) => setOrganizationId(event.target.value)}
          className="sm:max-w-xs"
        />
      </div>

      <Table>
        <TableHead>
          <TableRow>
            <TableHeaderCell>User</TableHeaderCell>
            <TableHeaderCell>Organization</TableHeaderCell>
            <TableHeaderCell>Status</TableHeaderCell>
            <TableHeaderCell>Role</TableHeaderCell>
            <TableHeaderCell>Actions</TableHeaderCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {filtered.map((user) => {
            const isSelf = user.id === currentUserId;
            const isSuspended = user.status === PortalUserStatus.SUSPENDED;
            return (
              <TableRow key={user.id}>
                <TableCell>
                  <p className="font-medium text-slate-900">{user.name}</p>
                  <p className="text-xs text-slate-500">{user.email}</p>
                </TableCell>
                <TableCell>{user.organizationName ?? <span className="text-slate-400">Not onboarded</span>}</TableCell>
                <TableCell>
                  <Badge color={isSuspended ? "red" : "green"}>{isSuspended ? "Suspended" : "Active"}</Badge>
                </TableCell>
                <TableCell>
                  {user.role ? (
                    <form action={setUserRoleFromForm.bind(null, user.id)} className="flex items-center gap-2">
                      <Select name="role" options={ROLE_OPTIONS} defaultValue={user.role} disabled={isSelf} className="py-1.5 text-xs" />
                      {!isSelf ? (
                        <Button type="submit" size="sm" variant="secondary">
                          Save
                        </Button>
                      ) : null}
                    </form>
                  ) : (
                    <span className="text-xs text-slate-400">—</span>
                  )}
                </TableCell>
                <TableCell>
                  {isSelf ? (
                    <span className="text-xs text-slate-400">This is you</span>
                  ) : (
                    <form
                      action={setUserStatus.bind(null, user.id, isSuspended ? PortalUserStatus.ACTIVE : PortalUserStatus.SUSPENDED)}
                    >
                      <Button type="submit" size="sm" variant={isSuspended ? "secondary" : "danger"}>
                        {isSuspended ? "Reactivate" : "Suspend"}
                      </Button>
                    </form>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
          {filtered.length === 0 ? (
            <TableRow>
              <TableCell colSpan={5} className="py-8 text-center text-slate-500">
                No users match this search.
              </TableCell>
            </TableRow>
          ) : null}
        </TableBody>
      </Table>
    </div>
  );
}
