import { UserRole } from "@/models";

/**
 * Authorization rules keyed on role, kept deliberately independent of how
 * the user was authenticated. Swapping the credentials provider in
 * `src/auth.ts` for Entra ID, Okta, Auth0, or a customer SSO connector
 * should never require changes here — the identity provider only needs
 * to resolve to a `PortalUser` with a `role`.
 */
export function canUploadData(role: UserRole): boolean {
  return role === UserRole.CUSTOMER_ADMIN || role === UserRole.CUSTOMER_USER;
}

export function canManageSettings(role: UserRole): boolean {
  return role === UserRole.CUSTOMER_ADMIN;
}

export function canManageEntitlements(role: UserRole): boolean {
  return role === UserRole.CUSTOMER_ADMIN;
}

export function isReadOnly(role: UserRole): boolean {
  return role === UserRole.CUSTOMER_READONLY;
}

/**
 * Platform-root: not scoped to any organization/tenant, can manage every
 * customer and platform-level settings from the Admin Console (`/admin`).
 */
export function isSuperuser(role: UserRole): boolean {
  return role === UserRole.SUPERUSER;
}
