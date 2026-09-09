import { createHash } from "node:crypto";
import { AppError } from "../../common/errors/app-error.js";
import { env } from "../../config/env.js";
import { findIdempotencyRecord, saveIdempotencyRecord } from "./idempotency.repository.js";
import { pool } from "../../database/pool.js";

function hashRequest(body: unknown): string {
  return createHash("sha256").update(JSON.stringify(body ?? null)).digest("hex");
}

export interface IdempotentResult<T> {
  status: number;
  body: T;
  resourceId: string | null;
}

// Spec §38: same key + same payload replays the original result; same key
// + a different payload is rejected outright rather than silently
// executing a second time. Reads before executing `fn` outside of `fn`'s
// own transaction — `fn` is expected to be the sole writer for its
// operation, so a replay never re-runs side effects.
export async function withIdempotency<T>(
  params: {
    idempotencyKey: string | undefined;
    organizationId: string;
    tenantId: string;
    operation: string;
    requestBody: unknown;
  },
  fn: () => Promise<IdempotentResult<T>>,
): Promise<IdempotentResult<T>> {
  if (!params.idempotencyKey) {
    return fn();
  }

  const requestHash = hashRequest(params.requestBody);
  const existing = await findIdempotencyRecord(pool, params.organizationId, params.tenantId, params.operation, params.idempotencyKey);

  if (existing) {
    if (existing.requestHash !== requestHash) {
      throw new AppError("IDEMPOTENCY_KEY_REUSED", "This Idempotency-Key was already used with a different request payload.");
    }
    return { status: existing.responseStatus, body: existing.responseBody as T, resourceId: existing.resourceId };
  }

  const result = await fn();

  try {
    await saveIdempotencyRecord(pool, {
      idempotencyKey: params.idempotencyKey,
      organizationId: params.organizationId,
      tenantId: params.tenantId,
      operation: params.operation,
      requestHash,
      responseStatus: result.status,
      responseBody: result.body,
      resourceId: result.resourceId,
      ttlHours: env.IDEMPOTENCY_TTL_HOURS,
    });
  } catch (err) {
    // A genuinely concurrent retry with the same key can lose this race
    // after both requests passed the lookup above and both ran `fn()`; the
    // underlying business unique constraints (e.g. one-live-subscription-
    // per-tenant-product) already prevent duplicate domain state (spec
    // §53), so on a primary-key collision here we just defer to whichever
    // request's record landed first rather than surfacing a 500.
    if ((err as { code?: string }).code === "23505") {
      const stored = await findIdempotencyRecord(pool, params.organizationId, params.tenantId, params.operation, params.idempotencyKey);
      if (stored) return { status: stored.responseStatus, body: stored.responseBody as T, resourceId: stored.resourceId };
    }
    throw err;
  }

  return result;
}
