export const UserRole = {
  SUPERUSER: "SUPERUSER",
  CUSTOMER_ADMIN: "CUSTOMER_ADMIN",
  CUSTOMER_USER: "CUSTOMER_USER",
  CUSTOMER_READONLY: "CUSTOMER_READONLY",
} as const;

export type UserRole = (typeof UserRole)[keyof typeof UserRole];

export const PortalUserStatus = {
  ACTIVE: "active",
  SUSPENDED: "suspended",
  /**
   * A first CUSTOMER_ADMIN created for a brand-new organization (see
   * `src/app/admin/organizations/actions.ts`), before a superuser has
   * validated the account. Blocked at sign-in the same way SUSPENDED is
   * (see `src/auth.ts`) until an admin approves it (see
   * `validatePendingMember` in
   * `src/app/admin/organizations/[organizationId]/actions.ts`).
   */
  PENDING_VALIDATION: "pending_validation",
} as const;

export type PortalUserStatus = (typeof PortalUserStatus)[keyof typeof PortalUserStatus];

export interface PortalUser {
  id: string;
  name: string;
  email: string;
  /**
   * Null means "hasn't finished onboarding yet" for every role except
   * SUPERUSER, for which null is permanent — a superuser is platform-root
   * and never belongs to an organization/tenant. See
   * `docs/user-org-tenant-model.md`.
   */
  organizationId: string | null;
  tenantId: string | null;
  role: UserRole | null;
  status: PortalUserStatus;
}
