// Port for the Catalog Service integration boundary (AGENTS.md section 47).
// Never accessed except through this interface — no direct DB reads, no
// copying Catalog tables into the Scheduler's own schema.
//
// Phase 10 §28/§32: five policy types instead of three (COMPATIBLE_MAJOR
// renamed to COMPATIBLE_MINOR, COMPATIBLE_PATCH/PINNED_MAJOR added).
export interface VersionPolicy {
  type: "EXACT" | "COMPATIBLE_PATCH" | "COMPATIBLE_MINOR" | "PINNED_MAJOR" | "LATEST_ACTIVE";
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
  // Phase 10 §27/§30: delegates to Catalog's centralized resolver — this
  // service never ranks versions itself. Always called with intent
  // "DELIVER" (the Scheduler is a delivery-time caller, spec §29), so a
  // floating policy may still resolve to a DEPRECATED-in-grace-period
  // version, not just ACTIVE.
  resolveVersionPolicy(dataProductId: string, policy: VersionPolicy): Promise<ResolvedCatalogVersion | null>;
  validateDeliveryCapability(dataProductId: string, version: string, method: string, format: string | null): Promise<DeliveryCapabilityResult>;
}
