import type pg from "pg";
import { pool } from "../../database/pool.js";

export interface ExchangeValidationRow {
  validation_id: string;
  exchange_id: string;
  validation_type: string | null;
  status: string;
  total_records: string | null;
  valid_records: string | null;
  invalid_records: string | null;
  error_summary: unknown;
  started_at: Date | null;
  completed_at: Date | null;
}

export async function createExchangeValidation(
  input: {
    validationId: string;
    exchangeId: string;
    validationType: string;
    status: string;
    totalRecords: number;
    validRecords: number;
    invalidRecords: number;
    errorSummary: unknown;
    startedAt: Date;
    completedAt: Date;
  },
  client: pg.PoolClient | pg.Pool = pool,
): Promise<ExchangeValidationRow> {
  const { rows } = await client.query<ExchangeValidationRow>(
    `INSERT INTO exchange.exchange_validations
       (validation_id, exchange_id, validation_type, status, total_records,
        valid_records, invalid_records, error_summary, started_at, completed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [
      input.validationId,
      input.exchangeId,
      input.validationType,
      input.status,
      input.totalRecords,
      input.validRecords,
      input.invalidRecords,
      JSON.stringify(input.errorSummary),
      input.startedAt,
      input.completedAt,
    ],
  );
  return rows[0]!;
}

export async function getExchangeValidation(exchangeId: string): Promise<ExchangeValidationRow | null> {
  const { rows } = await pool.query<ExchangeValidationRow>(
    `SELECT * FROM exchange.exchange_validations WHERE exchange_id = $1 ORDER BY started_at DESC LIMIT 1`,
    [exchangeId],
  );
  return rows[0] ?? null;
}
