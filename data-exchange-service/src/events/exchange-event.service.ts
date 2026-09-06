import type pg from "pg";
import { generateEventId } from "../common/ids/id-generator.js";
import { pool } from "../database/pool.js";
import type { AppendExchangeEventInput, ExchangeEventRecord } from "./event.types.js";

function mapRow(row: Record<string, unknown>): ExchangeEventRecord {
  return {
    eventId: row.event_id as string,
    exchangeId: row.exchange_id as string,
    eventType: row.event_type as string,
    fromStatus: (row.from_status as string) ?? null,
    toStatus: (row.to_status as string) ?? null,
    actorType: (row.actor_type as string) ?? null,
    actorId: (row.actor_id as string) ?? null,
    eventData: (row.event_data as Record<string, unknown>) ?? null,
    occurredAt: (row.occurred_at as Date).toISOString(),
  };
}

// Append-only by construction: this service exposes no update/delete.
export async function appendExchangeEvent(
  input: AppendExchangeEventInput,
  client?: pg.PoolClient | pg.Pool,
): Promise<ExchangeEventRecord> {
  const db = client ?? pool;
  const eventId = generateEventId();
  const { rows } = await db.query(
    `INSERT INTO exchange.exchange_events
       (event_id, exchange_id, event_type, from_status, to_status, actor_type, actor_id, event_data, occurred_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
     RETURNING *`,
    [
      eventId,
      input.exchangeId,
      input.eventType,
      input.fromStatus ?? null,
      input.toStatus ?? null,
      input.actorType,
      input.actorId ?? null,
      input.eventData ? JSON.stringify(input.eventData) : null,
    ],
  );
  return mapRow(rows[0]);
}

export async function listExchangeEvents(exchangeId: string): Promise<ExchangeEventRecord[]> {
  const { rows } = await pool.query(
    `SELECT * FROM exchange.exchange_events WHERE exchange_id = $1 ORDER BY occurred_at ASC`,
    [exchangeId],
  );
  return rows.map(mapRow);
}
