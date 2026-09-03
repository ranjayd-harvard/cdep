export type ApiKeyStatus = "active" | "revoked";

export interface ApiCredential {
  id: string;
  label: string;
  maskedKey: string;
  status: ApiKeyStatus;
  createdAt: string;
  createdBy: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

/**
 * Returned only from `createApiKey`, never persisted or re-fetchable — the
 * `secret` is the one and only time the raw key is available in full. Every
 * other read of API access data returns `ApiCredential.maskedKey` instead.
 */
export interface CreatedApiKey {
  credential: ApiCredential;
  secret: string;
}

export interface ApiEndpoint {
  method: "GET" | "POST" | "PUT" | "DELETE";
  path: string;
  description: string;
}

export interface ApiAccessInfo {
  status: "Active" | "Suspended";
  baseUrl: string;
  credentials: ApiCredential[];
  endpoints: ApiEndpoint[];
}
