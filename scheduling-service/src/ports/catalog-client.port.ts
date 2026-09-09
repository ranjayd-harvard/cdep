// Port for the Catalog Service integration boundary (AGENTS.md section 47).
// Never accessed except through this interface — no direct DB reads, no
// copying Catalog tables into the Scheduler's own schema.
export interface VersionPolicy {
  type: "EXACT" | "COMPATIBLE_MAJOR" | "LATEST_ACTIVE";
  value: string | null;
}

export interface CatalogVersionInfo {
  version: string;
  lifecycleStatus: string;
}

export interface CatalogDeliveryMethodInfo {
  type: string;
  formats?: string[];
}

export interface CatalogVersionDetail extends CatalogVersionInfo {
  delivery: CatalogDeliveryMethodInfo[];
}

export interface CatalogProductDetail {
  dataProductId: string;
  status: string;
}

export interface ResolvedCatalogVersion {
  version: string;
  lifecycleStatus: string;
}

export interface DeliveryCapabilityResult {
  supported: boolean;
  reason?: "DELIVERY_METHOD_UNSUPPORTED" | "FORMAT_UNSUPPORTED";
}

export interface CatalogClient {
  getProduct(dataProductId: string): Promise<CatalogProductDetail | null>;
  getVersion(dataProductId: string, version: string): Promise<CatalogVersionDetail | null>;
  listVersions(dataProductId: string): Promise<CatalogVersionInfo[]>;
  resolveVersionPolicy(dataProductId: string, policy: VersionPolicy): Promise<ResolvedCatalogVersion | null>;
  validateDeliveryCapability(dataProductId: string, version: string, method: string, format: string | null): Promise<DeliveryCapabilityResult>;
}
