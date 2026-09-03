import type { ApiAccessInfo, CreatedApiKey } from "@/models";

export interface ApiAccessService {
  getApiAccessInfo(tenantId: string): Promise<ApiAccessInfo>;
  createApiKey(tenantId: string, label: string, createdBy: string): Promise<CreatedApiKey>;
  revokeApiKey(tenantId: string, keyId: string): Promise<void>;
}
