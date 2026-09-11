/**
 * Superadmin-only, cross-tenant surface backing `/admin/catalog` — Phase
 * 10's version lifecycle/compatibility/migration control plane, owned by
 * data-product-catalog-service. Deliberately separate from any
 * customer-facing interface, same precedent as `ObservabilityAdminService`.
 * Catalog itself is what calls out to subscription-service/
 * scheduling-service/data-publication-service for the retirement guard —
 * this interface never talks to those directly.
 */
export interface AdminVersionRow {
  version: string;
  lifecycleStatus: string;
  compatibilityType: string;
  breakingChange: boolean;
  migrationRequired: boolean;
  predecessorVersion: string | null;
  successorVersion: string | null;
  gracePeriodEnd: string | null;
  activatedAt: string | null;
  effectiveFrom: string | null;
  deprecatedAt: string | null;
  retiredAt: string | null;
  createdAt: string;
}

export interface AdminMigrationRow {
  migrationId: string;
  fromVersion: string;
  toVersion: string;
  compatibility: string;
  status: string;
  reason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdminImpactSummary {
  fromVersion: string;
  toVersion: string;
  subscriberCount: number;
  automaticallyCompatible: number;
  resolvesToTo: number;
  pinned: number;
  betaOptIn: number;
  requiresExplicitMigration: number;
}

// Every mutation returns this uniform shape (mirroring
// `RunPipelineJobResult` in `pipeline-job-admin-service.ts`) so
// `/admin/catalog/actions.ts` can redirect with a flash message the same
// way every other admin action file already does — never throws for an
// expected domain rejection (e.g. a blocked retirement), only for a
// genuinely unavailable/misconfigured service.
export interface AdminActionResult {
  ok: boolean;
  errorCode?: string;
  errorMessage?: string;
  blockers?: Array<{ type: string; detail: string; count?: number }>;
}

export interface ProductVersioningAdminService {
  listProducts(): Promise<{ available: boolean; items: Array<{ dataProductId: string; name: string; status: string }> }>;
  listVersions(dataProductId: string): Promise<{ available: boolean; items: AdminVersionRow[] }>;
  activateVersion(dataProductId: string, version: string, targetStatus: "ACTIVE" | "BETA", actorEmail: string): Promise<AdminActionResult>;
  deprecateVersion(
    dataProductId: string,
    version: string,
    input: { reason?: string; gracePeriodDays?: number; replacementVersion?: string },
    actorEmail: string,
  ): Promise<AdminActionResult>;
  retireVersion(dataProductId: string, version: string, input: { reason?: string; force?: boolean }, actorEmail: string): Promise<AdminActionResult>;
  rollbackVersion(dataProductId: string, version: string, reason: string | undefined, actorEmail: string): Promise<AdminActionResult>;
  approveVersion(dataProductId: string, version: string, reason: string | undefined, actorEmail: string): Promise<AdminActionResult>;
  grantBetaOptIn(
    dataProductId: string,
    version: string,
    input: { organizationId: string; tenantId: string },
    actorEmail: string,
  ): Promise<AdminActionResult>;
  getImpact(dataProductId: string, version: string, against?: string): Promise<AdminImpactSummary | null>;
  listMigrations(dataProductId: string): Promise<{ available: boolean; items: AdminMigrationRow[] }>;
  createMigration(
    dataProductId: string,
    input: { toVersion: string; reason?: string },
    actorEmail: string,
  ): Promise<AdminActionResult & { affectedSubscriptions?: number }>;
  executeMigration(dataProductId: string, migrationId: string, actorEmail: string): Promise<AdminActionResult>;
}
