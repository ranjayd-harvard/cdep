import type { ApiAccessInfo, ApiEndpoint, CreatedApiKey } from "@/models";
import type { ApiAccessService } from "@/services/interfaces";
import { createApiKey, listApiKeys, revokeApiKey } from "@/lib/api-key-directory";
import { findTenantById } from "@/lib/tenant-directory";
import { env } from "@/config/env";

const REFERENCE_ENDPOINTS: ApiEndpoint[] = [
  { method: "GET", path: "/datasets", description: "List all data products entitled to your organization." },
  { method: "GET", path: "/datasets/{datasetId}", description: "Retrieve details for a specific data product." },
  { method: "GET", path: "/exchanges", description: "List inbound and outbound data exchanges." },
  { method: "GET", path: "/exchanges/{exchangeId}", description: "Retrieve details for a specific exchange." },
  { method: "POST", path: "/uploads", description: "Submit a new inbound data file for processing." },
];

export class MongoApiAccessService implements ApiAccessService {
  async getApiAccessInfo(tenantId: string): Promise<ApiAccessInfo> {
    const [tenant, credentials] = await Promise.all([findTenantById(tenantId), listApiKeys(tenantId)]);

    return {
      status: tenant?.status === "active" ? "Active" : "Suspended",
      baseUrl: `${env.apiBaseUrl}/data-exchange/v1`,
      credentials,
      endpoints: REFERENCE_ENDPOINTS,
    };
  }

  createApiKey(tenantId: string, label: string, createdBy: string): Promise<CreatedApiKey> {
    return createApiKey(tenantId, label, createdBy);
  }

  revokeApiKey(tenantId: string, keyId: string): Promise<void> {
    return revokeApiKey(tenantId, keyId);
  }
}
