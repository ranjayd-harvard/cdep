import { AppError } from "../../common/errors/app-error.js";
import { withTransaction } from "../../database/transaction.js";
import { pool } from "../../database/pool.js";
import { recordAuditEvent } from "../../infrastructure/persistence/audit.repository.js";
import {
  findDeadLetterById,
  listDeadLetters,
  markDeadLetterResolved,
  type DeadLetterPage,
  type ListDeadLetterFilter,
} from "../../infrastructure/persistence/dead-letter.repository.js";
import { findExecutionById, resetForRedrive } from "../../infrastructure/persistence/execution.repository.js";
import type { DeadLetterRecord, ScheduledExecution } from "../../domain/execution.js";

// AGENTS.md section 42: operator-facing dead-letter inspection/redrive.
// Redrive preserves execution_key/scheduled_for — it re-enters the exact
// same logical execution (attempt_count reset, since this is a deliberate
// fresh operator-initiated attempt), never a new one. Publication Service's
// own external_idempotency_key dedup means even a redrive that lands after
// an earlier attempt secretly succeeded is still safe: it short-circuits
// to SKIPPED_DUPLICATE rather than creating a second artifact.
export class DeadLetterService {
  list(filter: ListDeadLetterFilter): Promise<DeadLetterPage> {
    return listDeadLetters(pool, filter);
  }

  async redrive(deadLetterId: string, actorId: string): Promise<ScheduledExecution> {
    const record = await findDeadLetterById(pool, deadLetterId);
    if (!record) {
      throw new AppError("DEAD_LETTER_NOT_FOUND", `Dead-letter record '${deadLetterId}' was not found.`);
    }
    if (record.resolvedAt) {
      throw new AppError("DEAD_LETTER_ALREADY_RESOLVED", `Dead-letter record '${deadLetterId}' was already resolved.`);
    }

    const execution = await findExecutionById(pool, record.executionId);
    if (!execution) {
      throw new AppError("EXECUTION_NOT_FOUND", `Execution '${record.executionId}' was not found.`);
    }
    if (execution.status !== "DEAD_LETTERED") {
      throw new AppError("EXECUTION_NOT_REDRIVABLE", `Execution '${execution.id}' is in status ${execution.status}, not DEAD_LETTERED.`);
    }

    const redriven = await withTransaction((client) => resetForRedrive(client, execution.id));

    await recordAuditEvent(pool, {
      eventType: "EXECUTION_REDRIVEN",
      actorType: "USER",
      actorId,
      organizationId: execution.organizationId,
      tenantId: execution.tenantId,
      subscriptionId: execution.subscriptionId,
      executionId: execution.id,
      correlationId: null,
      metadata: { deadLetterId },
    });

    return redriven;
  }

  async resolve(deadLetterId: string, actorId: string, note: string | null): Promise<DeadLetterRecord> {
    const record = await findDeadLetterById(pool, deadLetterId);
    if (!record) {
      throw new AppError("DEAD_LETTER_NOT_FOUND", `Dead-letter record '${deadLetterId}' was not found.`);
    }
    if (record.resolvedAt) {
      throw new AppError("DEAD_LETTER_ALREADY_RESOLVED", `Dead-letter record '${deadLetterId}' was already resolved.`);
    }

    const resolved = await withTransaction((client) => markDeadLetterResolved(client, deadLetterId, note));

    await recordAuditEvent(pool, {
      eventType: "DEAD_LETTER_RESOLVED",
      actorType: "USER",
      actorId,
      organizationId: record.organizationId,
      tenantId: record.tenantId,
      subscriptionId: record.subscriptionId,
      executionId: record.executionId,
      correlationId: null,
      metadata: { note },
    });

    return resolved;
  }
}
