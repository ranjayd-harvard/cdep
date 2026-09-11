import type {
  AdminActionResult,
  AdminImpactSummary,
  AdminMigrationRow,
  AdminVersionRow,
  ProductVersioningAdminService,
} from "@/services/interfaces";
import {
  activateCatalogVersion,
  approveCatalogVersion,
  CatalogServiceError,
  createCatalogMigration,
  deprecateCatalogVersion,
  executeCatalogMigration,
  getCatalogImpact,
  grantCatalogBetaOptIn,
  listAllCatalogVersions,
  listCatalogMigrations,
  listCatalogProducts,
  retireCatalogVersion,
  rollbackCatalogVersion,
} from "@/lib/catalog-service/client";

function toVersionRow(v: {
  version: string;
  lifecycle_status: string;
  compatibility_type: string;
  breaking_change: boolean;
  migration_required: boolean;
  predecessor_version: string | null;
  successor_version: string | null;
  grace_period_end: string | null;
  activated_at: string | null;
  effective_from: string | null;
  deprecated_at: string | null;
  retired_at: string | null;
  created_at: string;
}): AdminVersionRow {
  return {
    version: v.version,
    lifecycleStatus: v.lifecycle_status,
    compatibilityType: v.compatibility_type,
    breakingChange: v.breaking_change,
    migrationRequired: v.migration_required,
    predecessorVersion: v.predecessor_version,
    successorVersion: v.successor_version,
    gracePeriodEnd: v.grace_period_end,
    activatedAt: v.activated_at,
    effectiveFrom: v.effective_from,
    deprecatedAt: v.deprecated_at,
    retiredAt: v.retired_at,
    createdAt: v.created_at,
  };
}

function toMigrationRow(m: {
  migration_id: string;
  from_version: string;
  to_version: string;
  compatibility: string;
  status: string;
  reason: string | null;
  created_at: string;
  updated_at: string;
}): AdminMigrationRow {
  return {
    migrationId: m.migration_id,
    fromVersion: m.from_version,
    toVersion: m.to_version,
    compatibility: m.compatibility,
    status: m.status,
    reason: m.reason,
    createdAt: m.created_at,
    updatedAt: m.updated_at,
  };
}

// A 4xx here is always an expected domain rejection this admin console
// should show as a flash message, never a crash — only NOT_CONFIGURED/5xx/
// network failures are genuinely unexpected and should propagate.
function toActionResult(err: unknown): AdminActionResult {
  if (err instanceof CatalogServiceError && err.status >= 400 && err.status < 500) {
    return { ok: false, errorCode: err.code, errorMessage: err.message, blockers: err.blockers };
  }
  throw err;
}

export class ProductVersioningAdminApiService implements ProductVersioningAdminService {
  async listProducts() {
    try {
      const { items } = await listCatalogProducts();
      return { available: true, items: items.map((p) => ({ dataProductId: p.dataProductId, name: p.name, status: p.status })) };
    } catch (err) {
      if (err instanceof CatalogServiceError && err.code === "NOT_CONFIGURED") {
        return { available: false, items: [] };
      }
      throw err;
    }
  }

  async listVersions(dataProductId: string) {
    try {
      const { items } = await listAllCatalogVersions(dataProductId);
      return { available: true, items: items.map(toVersionRow) };
    } catch (err) {
      if (err instanceof CatalogServiceError && err.code === "NOT_CONFIGURED") {
        return { available: false, items: [] };
      }
      throw err;
    }
  }

  async activateVersion(dataProductId: string, version: string, targetStatus: "ACTIVE" | "BETA", actorEmail: string): Promise<AdminActionResult> {
    try {
      await activateCatalogVersion(dataProductId, version, targetStatus, actorEmail);
      return { ok: true };
    } catch (err) {
      return toActionResult(err);
    }
  }

  async deprecateVersion(
    dataProductId: string,
    version: string,
    input: { reason?: string; gracePeriodDays?: number; replacementVersion?: string },
    actorEmail: string,
  ): Promise<AdminActionResult> {
    try {
      await deprecateCatalogVersion(dataProductId, version, input, actorEmail);
      return { ok: true };
    } catch (err) {
      return toActionResult(err);
    }
  }

  async retireVersion(dataProductId: string, version: string, input: { reason?: string; force?: boolean }, actorEmail: string): Promise<AdminActionResult> {
    try {
      await retireCatalogVersion(dataProductId, version, input, actorEmail);
      return { ok: true };
    } catch (err) {
      return toActionResult(err);
    }
  }

  async rollbackVersion(dataProductId: string, version: string, reason: string | undefined, actorEmail: string): Promise<AdminActionResult> {
    try {
      await rollbackCatalogVersion(dataProductId, version, reason, actorEmail);
      return { ok: true };
    } catch (err) {
      return toActionResult(err);
    }
  }

  async approveVersion(dataProductId: string, version: string, reason: string | undefined, actorEmail: string): Promise<AdminActionResult> {
    try {
      await approveCatalogVersion(dataProductId, version, reason, actorEmail);
      return { ok: true };
    } catch (err) {
      return toActionResult(err);
    }
  }

  async grantBetaOptIn(
    dataProductId: string,
    version: string,
    input: { organizationId: string; tenantId: string },
    actorEmail: string,
  ): Promise<AdminActionResult> {
    try {
      await grantCatalogBetaOptIn(dataProductId, version, input, actorEmail);
      return { ok: true };
    } catch (err) {
      return toActionResult(err);
    }
  }

  async getImpact(dataProductId: string, version: string, against?: string): Promise<AdminImpactSummary | null> {
    try {
      const impact = await getCatalogImpact(dataProductId, version, against);
      return {
        fromVersion: impact.from_version,
        toVersion: impact.to_version,
        subscriberCount: impact.subscriber_count,
        automaticallyCompatible: impact.automatically_compatible,
        resolvesToTo: impact.resolves_to_to,
        pinned: impact.pinned,
        betaOptIn: impact.beta_opt_in,
        requiresExplicitMigration: impact.requires_explicit_migration,
      };
    } catch (err) {
      if (err instanceof CatalogServiceError) return null;
      throw err;
    }
  }

  async listMigrations(dataProductId: string) {
    try {
      const { items } = await listCatalogMigrations(dataProductId);
      return { available: true, items: items.map(toMigrationRow) };
    } catch (err) {
      if (err instanceof CatalogServiceError && err.code === "NOT_CONFIGURED") {
        return { available: false, items: [] };
      }
      throw err;
    }
  }

  async createMigration(
    dataProductId: string,
    input: { toVersion: string; reason?: string },
    actorEmail: string,
  ): Promise<AdminActionResult & { affectedSubscriptions?: number }> {
    try {
      const result = await createCatalogMigration(dataProductId, input, actorEmail);
      return { ok: true, affectedSubscriptions: result.affected_subscriptions };
    } catch (err) {
      return toActionResult(err);
    }
  }

  async executeMigration(dataProductId: string, migrationId: string, actorEmail: string): Promise<AdminActionResult> {
    try {
      await executeCatalogMigration(dataProductId, migrationId, actorEmail);
      return { ok: true };
    } catch (err) {
      return toActionResult(err);
    }
  }
}
