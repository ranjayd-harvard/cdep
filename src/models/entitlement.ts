export const EntitlementStatus = {
  ACTIVE: "ACTIVE",
  REVOKED: "REVOKED",
  EXPIRED: "EXPIRED",
} as const;

export type EntitlementStatus = (typeof EntitlementStatus)[keyof typeof EntitlementStatus];

/**
 * The join between a Tenant and a DataProduct: the single record that
 * says "this tenant may see that data product." Nothing upstream of
 * this — not a Dataset, not a DataProduct — carries a tenantId of its
 * own, because the catalog is shared across tenants. This is the one
 * collection that is genuinely tenant-owned data, and the only place
 * entitlement is granted or revoked.
 */
export interface Entitlement {
  id: string;
  tenantId: string;
  dataProductId: string;
  status: EntitlementStatus;
  grantedAt: string;
  grantedBy: string;
  expiresAt: string | null;
}
