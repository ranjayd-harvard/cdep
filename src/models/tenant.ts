export type TenantStatus = "active" | "inactive";

export interface Tenant {
  id: string;
  organizationId: string;
  name: string;
  displayName: string;
  isDefault: boolean;
  status: TenantStatus;
}
