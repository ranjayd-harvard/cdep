import type pg from "pg";
import { pool } from "../database/pool.js";
import { generateDeletionRequestId } from "../common/ids/id-generator.js";
import type { DeletionRequestStatus } from "../config/constants.js";

export interface DeletionRequestRow {
  deletion_request_id: string;
  exchange_id: string;
  status: DeletionRequestStatus;
  reason: string | null;
  requested_by: string | null;
  requested_at: Date;
  completed_at: Date | null;
  error_message: string | null;
}

export async function createDeletionRequest(
  client: pg.PoolClient | pg.Pool,
  input: { exchangeId: string; reason?: string | null; requestedBy?: string | null },
): Promise<DeletionRequestRow> {
  const { rows } = await client.query<DeletionRequestRow>(
    `INSERT INTO exchange.deletion_requests (deletion_request_id, exchange_id, status, reason, requested_by)
     VALUES ($1, $2, 'REQUESTED', $3, $4)
     RETURNING *`,
    [generateDeletionRequestId(), input.exchangeId, input.reason ?? null, input.requestedBy ?? null],
  );
  const row = rows[0];
  if (!row) throw new Error("Failed to create deletion request");
  return row;
}

export async function updateDeletionRequestStatus(
  client: pg.PoolClient | pg.Pool,
  deletionRequestId: string,
  status: DeletionRequestStatus,
  extra: { completedAt?: Date; errorMessage?: string } = {},
): Promise<void> {
  await client.query(
    `UPDATE exchange.deletion_requests
     SET status = $2, completed_at = COALESCE($3, completed_at), error_message = COALESCE($4, error_message)
     WHERE deletion_request_id = $1`,
    [deletionRequestId, status, extra.completedAt ?? null, extra.errorMessage ?? null],
  );
}

export async function getDeletionRequestById(
  deletionRequestId: string,
  client: pg.Pool | pg.PoolClient = pool,
): Promise<DeletionRequestRow | null> {
  const { rows } = await client.query<DeletionRequestRow>(
    `SELECT * FROM exchange.deletion_requests WHERE deletion_request_id = $1`,
    [deletionRequestId],
  );
  return rows[0] ?? null;
}

export async function listDeletionRequestsForExchange(
  exchangeId: string,
  client: pg.Pool | pg.PoolClient = pool,
): Promise<DeletionRequestRow[]> {
  const { rows } = await client.query<DeletionRequestRow>(
    `SELECT * FROM exchange.deletion_requests WHERE exchange_id = $1 ORDER BY requested_at DESC`,
    [exchangeId],
  );
  return rows;
}
