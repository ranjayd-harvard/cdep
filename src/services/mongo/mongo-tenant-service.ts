import type { Tenant } from "@/models";
import type { TenantService } from "@/services/interfaces";
import {
  createTenant,
  findDefaultTenantForOrganization,
  findTenantById,
  listTenantsByOrganization,
  setDefaultTenant,
  setTenantStatus,
} from "@/lib/tenant-directory";

export class MongoTenantService implements TenantService {
  getTenant(tenantId: string): Promise<Tenant | null> {
    return findTenantById(tenantId);
  }

  listTenants(organizationId: string): Promise<Tenant[]> {
    return listTenantsByOrganization(organizationId);
  }

  getDefaultTenant(organizationId: string): Promise<Tenant | null> {
    return findDefaultTenantForOrganization(organizationId);
  }

  createTenant(organizationId: string, displayName: string): Promise<Tenant> {
    return createTenant({ organizationId, displayName, isDefault: false });
  }

  setDefaultTenant(organizationId: string, tenantId: string): Promise<void> {
    return setDefaultTenant(organizationId, tenantId);
  }

  setTenantStatus(tenantId: string, status: Tenant["status"]): Promise<void> {
    return setTenantStatus(tenantId, status);
  }
}
