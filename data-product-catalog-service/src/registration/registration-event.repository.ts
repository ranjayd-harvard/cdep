import type pg from "pg";
import { pool } from "../database/pool.js";
import { generateRegistrationEventId } from "../common/ids/id-generator.js";
import type { RegistrationEventType } from "../config/constants.js";
import type { RequestContext } from "../auth/request-context.js";

export interface RegistrationEventRow {
  event_id: string;
  data_product_id: string;
  version: string | null;
  event_type: string;
  actor_type: string;
  actor_id: string | null;
  event_data: Record<string, unknown>;
  occurred_at: Date;
}

export async function recordEvent(
  client: pg.PoolClient,
  input: {
    dataProductId: string;
    version?: string;
    eventType: RegistrationEventType;
    actor: RequestContext;
    eventData?: Record<string, unknown>;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO catalog.registration_events (event_id, data_product_id, version, event_type, actor_type, actor_id, event_data)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      generateRegistrationEventId(),
      input.dataProductId,
      input.version ?? null,
      input.eventType,
      input.actor.actorType,
      input.actor.actorId,
      JSON.stringify(input.eventData ?? {}),
    ],
  );
}

export async function listEvents(dataProductId: string): Promise<RegistrationEventRow[]> {
  const { rows } = await pool.query<RegistrationEventRow>(
    `SELECT * FROM catalog.registration_events WHERE data_product_id = $1 ORDER BY occurred_at ASC`,
    [dataProductId],
  );
  return rows;
}
