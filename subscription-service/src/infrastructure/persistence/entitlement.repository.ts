import type { Entitlement } from "../../domain/entitlement.js";
import type { EntitlementEffect } from "../../config/constants.js";
import { AppError } from "../../common/errors/app-error.js";
import type { Queryable } from "./queryable.js";

interface EntitlementRow {
  entitlement_id: string;
  organization_id: string;
  tenant_id: string;
  data_product_id: string;
  effect: EntitlementEffect;
  valid_from: Date | null;
  valid_until: Date | null;
  reason: string | null;
  created_by: string;
  created_at: Date;
  updated_by: string | null;
  updated_at: Date;
  revoked_at: Date | null;
  revoked_by: string | null;
  version: string | number;
}

function mapRow(row: EntitlementRow): Entitlement {
  return {
    entitlementId: row.entitlement_id,
    organizationId: row.organization_id,
    tenantId: row.tenant_id,
    dataProductId: row.data_product_id,
    effect: row.effect,
    validFrom: row.valid_from,
    validUntil: row.valid_until,
    reason: row.reason,
    revokedAt: row.revoked_at,
    revokedBy: row.revoked_by,
    version: Number(row.version),
  };
}

export async function findEntitlementByTenantProduct(
  db: Queryable,
  organizationId: string,
  tenantId: string,
  dataProductId: string,
): Promise<Entitlement | null> {
  const { rows } = await db.query<EntitlementRow>(
    `SELECT * FROM entitlements WHERE organization_id = $1 AND tenant_id = $2 AND data_product_id = $3`,
    [organizationId, tenantId, dataProductId],
  );
  return rows[0] ? mapRow(rows[0]) : null;
}

export async function findEntitlementById(db: Queryable, entitlementId: string): Promise<Entitlement | null> {
  const { rows } = await db.query<EntitlementRow>(`SELECT * FROM entitlements WHERE entitlement_id = $1`, [
    entitlementId,
  ]);
  return rows[0] ? mapRow(rows[0]) : null;
}

export async function listEntitlementsForTenant(
  db: Queryable,
  organizationId: string,
  tenantId: string,
): Promise<Entitlement[]> {
  const { rows } = await db.query<EntitlementRow>(
    `SELECT * FROM entitlements WHERE organization_id = $1 AND tenant_id = $2 ORDER BY created_at DESC`,
    [organizationId, tenantId],
  );
  return rows.map(mapRow);
}

export interface UpsertEntitlementInput {
  entitlementId: string;
  organizationId: string;
  tenantId: string;
  dataProductId: string;
  effect: EntitlementEffect;
  validFrom: Date | null;
  validUntil: Date | null;
  reason: string | null;
  actorId: string;
}

// One current decision per tenant/product (spec §11) — grant/deny upserts
// on the (organization_id, tenant_id, data_product_id) unique index rather
// than accumulating rows. History lives in subscription_audit_events.
export async function upsertEntitlement(db: Queryable, input: UpsertEntitlementInput): Promise<Entitlement> {
  const { rows } = await db.query<EntitlementRow>(
    `INSERT INTO entitlements (
       entitlement_id, organization_id, tenant_id, data_product_id,
       effect, valid_from, valid_until, reason, created_by, updated_by
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
     ON CONFLICT (organization_id, tenant_id, data_product_id) DO UPDATE SET
       effect = EXCLUDED.effect,
       valid_from = EXCLUDED.valid_from,
       valid_until = EXCLUDED.valid_until,
       reason = EXCLUDED.reason,
       updated_by = EXCLUDED.updated_by,
       updated_at = now(),
       revoked_at = CASE WHEN EXCLUDED.effect = 'DENY' AND entitlements.effect = 'ALLOW'
                         THEN now() ELSE entitlements.revoked_at END,
       revoked_by = CASE WHEN EXCLUDED.effect = 'DENY' AND entitlements.effect = 'ALLOW'
                         THEN EXCLUDED.updated_by ELSE entitlements.revoked_by END,
       version = entitlements.version + 1
     RETURNING *`,
    [input.entitlementId, input.organizationId, input.tenantId, input.dataProductId, input.effect, input.validFrom, input.validUntil, input.reason, input.actorId],
  );
  return mapRow(rows[0] as EntitlementRow);
}

export interface SetEntitlementEffectInput {
  entitlementId: string;
  expectedVersion: number;
  effect: EntitlementEffect;
  validFrom?: Date | null;
  validUntil?: Date | null;
  reason?: string | null;
  actorId: string;
}

// Optimistic concurrency (spec §39) — allow/deny/update all go through
// this, so a lost update surfaces as CONCURRENT_MODIFICATION rather than
// silently overwriting a concurrent admin action.
export async function setEntitlementEffect(db: Queryable, input: SetEntitlementEffectInput): Promise<Entitlement> {
  const current = await findEntitlementById(db, input.entitlementId);
  if (!current) {
    throw new AppError("ENTITLEMENT_NOT_FOUND", `Entitlement '${input.entitlementId}' does not exist.`);
  }

  const validFrom = input.validFrom !== undefined ? input.validFrom : current.validFrom;
  const validUntil = input.validUntil !== undefined ? input.validUntil : current.validUntil;
  const reason = input.reason !== undefined ? input.reason : current.reason;
  const isRevoke = input.effect === "DENY" && current.effect === "ALLOW";

  const { rows } = await db.query<EntitlementRow>(
    `UPDATE entitlements SET
       effect = $1, valid_from = $2, valid_until = $3, reason = $4,
       updated_by = $5, updated_at = now(),
       revoked_at = CASE WHEN $6 THEN now() ELSE revoked_at END,
       revoked_by = CASE WHEN $6 THEN $5 ELSE revoked_by END,
       version = version + 1
     WHERE entitlement_id = $7 AND version = $8
     RETURNING *`,
    [input.effect, validFrom, validUntil, reason, input.actorId, isRevoke, input.entitlementId, input.expectedVersion],
  );

  if (rows.length === 0) {
    throw new AppError("CONCURRENT_MODIFICATION", `Entitlement '${input.entitlementId}' was modified concurrently.`);
  }
  return mapRow(rows[0] as EntitlementRow);
}
