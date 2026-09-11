import { createHash } from "node:crypto";
import { AppError } from "../../common/errors/app-error.js";
import { env } from "../../config/env.js";
import { pool } from "../../database/pool.js";
import { findIdempotencyRecord, saveIdempotencyRecord } from "./idempotency.repository.js";

function hashRequest(body: unknown): string {
  return createHash("sha256").update(JSON.stringify(body ?? null)).digest("hex");
}

export interface IdempotentResult<T> {
  status: number;
  body: T;
  resourceId: string | null;
}

// Phase 10 §43/§65: ported from subscription-service's with-idempotency.ts
// (same shape) — same key + same payload replays the original result; same
// key + a different payload is rejected. Currently used only by
// POST .../migrations (§35's external_idempotency_key).
export async function withIdempotency<T>(
  params: { idempotencyKey: string | undefined; scope: string; operation: string; requestBody: unknown },
  fn: () => Promise<IdempotentResult<T>>,
): Promise<IdempotentResult<T>> {
  if (!params.idempotencyKey) {
    return fn();
  }

  const requestHash = hashRequest(params.requestBody);
  const existing = await findIdempotencyRecord(pool, params.scope, params.operation, params.idempotencyKey);

  if (existing) {
    if (existing.requestHash !== requestHash) {
      throw new AppError("IDEMPOTENCY_KEY_REUSED", "This idempotency key was already used with a different request payload.");
    }
    return { status: existing.responseStatus, body: existing.responseBody as T, resourceId: existing.resourceId };
  }

  const result = await fn();

  try {
    await saveIdempotencyRecord(pool, {
      idempotencyKey: params.idempotencyKey,
      scope: params.scope,
      operation: params.operation,
      requestHash,
      responseStatus: result.status,
      responseBody: result.body,
      resourceId: result.resourceId,
      ttlHours: env.IDEMPOTENCY_TTL_HOURS,
    });
  } catch (err) {
    // A genuinely concurrent retry with the same key can lose this race —
    // defer to whichever request's record landed first rather than a 500.
    if ((err as { code?: string }).code === "23505") {
      const stored = await findIdempotencyRecord(pool, params.scope, params.operation, params.idempotencyKey);
      if (stored) return { status: stored.responseStatus, body: stored.responseBody as T, resourceId: stored.resourceId };
    }
    throw err;
  }

  return result;
}
