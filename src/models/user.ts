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
