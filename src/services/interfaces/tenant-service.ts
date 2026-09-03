import type { Tenant } from "@/models";

export interface TenantService {
  getTenant(tenantId: string): Promise<Tenant | null>;
  listTenants(organizationId: string): Promise<Tenant[]>;
  getDefaultTenant(organizationId: string): Promise<Tenant | null>;
  createTenant(organizationId: string, displayName: string): Promise<Tenant>;
  setDefaultTenant(organizationId: string, tenantId: string): Promise<void>;
  setTenantStatus(tenantId: string, status: Tenant["status"]): Promise<void>;
}
