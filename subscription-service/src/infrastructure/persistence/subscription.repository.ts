import { AppError } from "../../common/errors/app-error.js";
import type { SubscriptionStatus } from "../../config/constants.js";
import type { Subscription } from "../../domain/subscription.js";
import type { Queryable } from "./queryable.js";

interface SubscriptionRow {
  subscription_id: string;
  organization_id: string;
  tenant_id: string;
  data_product_id: string;
  status: SubscriptionStatus;
  version_policy_type: "EXACT" | "COMPATIBLE_MAJOR" | "LATEST_ACTIVE";
  version_policy_value: string | null;
  requested_at: Date;
  activated_at: Date | null;
  paused_at: Date | null;
  suspended_at: Date | null;
  cancelled_at: Date | null;
  suspension_reason: string | null;
  cancellation_reason: string | null;
  version: string | number;
}

function mapRow(row: SubscriptionRow): Subscription {
  return {
    subscriptionId: row.subscription_id,
    organizationId: row.organization_id,
    tenantId: row.tenant_id,
    dataProductId: row.data_product_id,
    status: row.status,
    versionPolicy: { type: row.version_policy_type, value: row.version_policy_value },
    requestedAt: row.requested_at,
    activatedAt: row.activated_at,
    pausedAt: row.paused_at,
    suspendedAt: row.suspended_at,
    cancelledAt: row.cancelled_at,
    suspensionReason: row.suspension_reason,
    cancellationReason: row.cancellation_reason,
    version: Number(row.version),
  };
}

// Tenant-scoped by construction (spec §32): every lookup requires both
// organization_id and tenant_id, never subscription_id alone, so a
// cross-tenant guess at an ID cannot resolve to another tenant's row.
export async function findSubscriptionByIdForTenant(
  db: Queryable,
  organizationId: string,
  tenantId: string,
  subscriptionId: string,
): Promise<Subscription | null> {
  const { rows } = await db.query<SubscriptionRow>(
    `SELECT * FROM subscriptions WHERE subscription_id = $1 AND organization_id = $2 AND tenant_id = $3`,
    [subscriptionId, organizationId, tenantId],
  );
  return rows[0] ? mapRow(rows[0]) : null;
}

// Internal-only lookup (Phase 7 delivery-context, entitlement-revocation
// cascade) where the caller is not a tenant session.
export async function findSubscriptionById(db: Queryable, subscriptionId: string): Promise<Subscription | null> {
  const { rows } = await db.query<SubscriptionRow>(`SELECT * FROM subscriptions WHERE subscription_id = $1`, [
    subscriptionId,
  ]);
  return rows[0] ? mapRow(rows[0]) : null;
}

export async function findSubscriptionByTenantProduct(
  db: Queryable,
  organizationId: string,
  tenantId: string,
  dataProductId: string,
): Promise<Subscription | null> {
  const { rows } = await db.query<SubscriptionRow>(
    `SELECT * FROM subscriptions WHERE organization_id = $1 AND tenant_id = $2 AND data_product_id = $3 AND status <> 'CANCELLED'`,
    [organizationId, tenantId, dataProductId],
  );
  return rows[0] ? mapRow(rows[0]) : null;
}

export async function listSubscriptionsForTenant(
  db: Queryable,
  organizationId: string,
  tenantId: string,
): Promise<Subscription[]> {
  const { rows } = await db.query<SubscriptionRow>(
    `SELECT * FROM subscriptions WHERE organization_id = $1 AND tenant_id = $2 ORDER BY requested_at DESC`,
    [organizationId, tenantId],
  );
  return rows.map(mapRow);
}

export interface DeliveryCandidateFilter {
  status?: SubscriptionStatus;
  dataProductId?: string;
  limit?: number;
  offset?: number;
}

export interface DeliveryCandidatePage {
  items: Subscription[];
  hasMore: boolean;
}

// Backs the Phase-7-facing /internal/v1/subscriptions/delivery-candidates
// read model (spec §36/§48). Declarative filtering only — no due-time
// logic. Paginated (limit/offset) so a Phase 7 reconciler can page through
// the full subscription set rather than requiring one unbounded fetch.
export async function listDeliveryCandidates(db: Queryable, filter: DeliveryCandidateFilter): Promise<DeliveryCandidatePage> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (filter.status) {
    params.push(filter.status);
    conditions.push(`status = $${params.length}`);
  }
  if (filter.dataProductId) {
    params.push(filter.dataProductId);
    conditions.push(`data_product_id = $${params.length}`);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const limit = Math.min(Math.max(filter.limit ?? 200, 1), 500);
  const offset = Math.max(filter.offset ?? 0, 0);
  params.push(limit + 1, offset);

  const { rows } = await db.query<SubscriptionRow>(
    `SELECT * FROM subscriptions ${where} ORDER BY requested_at ASC, subscription_id ASC LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  const hasMore = rows.length > limit;
  return { items: rows.slice(0, limit).map(mapRow), hasMore };
}

export interface InsertSubscriptionInput {
  subscriptionId: string;
  organizationId: string;
  tenantId: string;
  dataProductId: string;
  status: SubscriptionStatus;
  versionPolicyType: "EXACT" | "COMPATIBLE_MAJOR" | "LATEST_ACTIVE";
  versionPolicyValue: string | null;
  activatedAt: Date | null;
  actorId: string;
}

export async function insertSubscription(db: Queryable, input: InsertSubscriptionInput): Promise<Subscription> {
  try {
    const { rows } = await db.query<SubscriptionRow>(
      `INSERT INTO subscriptions (
         subscription_id, organization_id, tenant_id, data_product_id,
         status, version_policy_type, version_policy_value, activated_at,
         created_by, updated_by
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
       RETURNING *`,
      [
        input.subscriptionId,
        input.organizationId,
        input.tenantId,
        input.dataProductId,
        input.status,
        input.versionPolicyType,
        input.versionPolicyValue,
        input.activatedAt,
        input.actorId,
      ],
    );
    return mapRow(rows[0] as SubscriptionRow);
  } catch (err) {
    if ((err as { code?: string }).code === "23505") {
      throw new AppError("SUBSCRIPTION_ALREADY_EXISTS", "An active subscription for this product already exists.");
    }
    throw err;
  }
}

export interface UpdateSubscriptionStatusInput {
  subscriptionId: string;
  expectedVersion: number;
  status: SubscriptionStatus;
  timestampColumn?: "activated_at" | "paused_at" | "suspended_at" | "cancelled_at";
  suspensionReason?: string | null;
  cancellationReason?: string | null;
  actorId: string;
}

// Optimistic concurrency (spec §39) — pause-vs-cancel, resume-vs-suspend
// races surface as CONCURRENT_MODIFICATION instead of a silent lost update.
export async function updateSubscriptionStatus(db: Queryable, input: UpdateSubscriptionStatusInput): Promise<Subscription> {
  const timestampSet = input.timestampColumn ? `, ${input.timestampColumn} = now()` : "";
  const { rows } = await db.query<SubscriptionRow>(
    `UPDATE subscriptions SET
       status = $1,
       suspension_reason = COALESCE($2, suspension_reason),
       cancellation_reason = COALESCE($3, cancellation_reason),
       updated_by = $4, updated_at = now(), version = version + 1
       ${timestampSet}
     WHERE subscription_id = $5 AND version = $6
     RETURNING *`,
    [input.status, input.suspensionReason ?? null, input.cancellationReason ?? null, input.actorId, input.subscriptionId, input.expectedVersion],
  );
  if (rows.length === 0) {
    throw new AppError("CONCURRENT_MODIFICATION", `Subscription '${input.subscriptionId}' was modified concurrently.`);
  }
  return mapRow(rows[0] as SubscriptionRow);
}

export interface UpdateVersionPolicyInput {
  subscriptionId: string;
  expectedVersion: number;
  versionPolicyType: "EXACT" | "COMPATIBLE_MAJOR" | "LATEST_ACTIVE";
  versionPolicyValue: string | null;
  actorId: string;
}

export async function updateSubscriptionVersionPolicy(db: Queryable, input: UpdateVersionPolicyInput): Promise<Subscription> {
  const { rows } = await db.query<SubscriptionRow>(
    `UPDATE subscriptions SET
       version_policy_type = $1, version_policy_value = $2,
       updated_by = $3, updated_at = now(), version = version + 1
     WHERE subscription_id = $4 AND version = $5
     RETURNING *`,
    [input.versionPolicyType, input.versionPolicyValue, input.actorId, input.subscriptionId, input.expectedVersion],
  );
  if (rows.length === 0) {
    throw new AppError("CONCURRENT_MODIFICATION", `Subscription '${input.subscriptionId}' was modified concurrently.`);
  }
  return mapRow(rows[0] as SubscriptionRow);
}
