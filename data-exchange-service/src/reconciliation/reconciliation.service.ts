import { pool } from "../database/pool.js";
import { appendExchangeEvent } from "../events/exchange-event.service.js";
import { logger } from "../common/logger/logger.js";

// AGENTS.md section 55: PostgreSQL and object storage are never updated in
// one distributed transaction, so the two can drift — e.g. an object was
// PUT to storage but the client never called /complete, or a signed upload
// URL expired before the client used it. This module detects (and, for the
// narrow "expired and never touched" case, resolves) that drift.
//
// Not wired to a scheduler in Phase 2 (per AGENTS.md section 55 — "do not
// build an elaborate scheduler yet"). A future cron/worker can simply call
// `reconcileOrphanExchanges()` on an interval (e.g. every 5 minutes).

export interface ReconciliationReport {
  expiredPendingUploads: string[];
}

export async function reconcileOrphanExchanges(pendingUploadTtlMinutes = 60): Promise<ReconciliationReport> {
  const { rows } = await pool.query<{ exchange_id: string; organization_id: string; tenant_id: string; status: string }>(
    `SELECT exchange_id, organization_id, tenant_id, status
     FROM exchange.exchanges
     WHERE direction = 'INBOUND'
       AND status IN ('PENDING_UPLOAD', 'UPLOADING')
       AND created_at < now() - ($1 || ' minutes')::interval`,
    [pendingUploadTtlMinutes],
  );

  const expired: string[] = [];
  for (const row of rows) {
    await pool.query(
      `UPDATE exchange.exchanges SET status = 'EXPIRED', updated_at = now()
       WHERE exchange_id = $1 AND organization_id = $2 AND tenant_id = $3`,
      [row.exchange_id, row.organization_id, row.tenant_id],
    );
    await appendExchangeEvent({
      exchangeId: row.exchange_id,
      eventType: "EXCHANGE_EXPIRED",
      fromStatus: row.status,
      toStatus: "EXPIRED",
      actorType: "SYSTEM",
      eventData: { reason: "Upload never completed before signed URL / TTL window elapsed." },
    });
    expired.push(row.exchange_id);
  }

  if (expired.length > 0) {
    logger.info({ count: expired.length, exchangeIds: expired }, "Reconciliation expired orphaned pending uploads");
  }

  return { expiredPendingUploads: expired };
}
