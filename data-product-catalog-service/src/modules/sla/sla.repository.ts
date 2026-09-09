import type pg from "pg";
import { pool } from "../../database/pool.js";
import { generateSlaPolicyId } from "../../common/ids/id-generator.js";

export interface SlaPolicyRow {
  sla_policy_id: string;
  data_product_version_id: string;
  freshness_minutes: number | null;
  availability_target_percent: string | null;
  delivery_deadline_expression: string | null;
  maximum_publication_latency_minutes: number | null;
}

export async function insertSlaPolicy(
  client: pg.PoolClient,
  input: {
    dataProductVersionId: string;
    freshnessMinutes?: number;
    availabilityTargetPercent?: number;
    deliveryDeadlineExpression?: string;
    maximumPublicationLatencyMinutes?: number;
  },
): Promise<SlaPolicyRow> {
  const { rows } = await client.query<SlaPolicyRow>(
    `INSERT INTO catalog.sla_policies
       (sla_policy_id, data_product_version_id, freshness_minutes, availability_target_percent, delivery_deadline_expression, maximum_publication_latency_minutes)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      generateSlaPolicyId(),
      input.dataProductVersionId,
      input.freshnessMinutes ?? null,
      input.availabilityTargetPercent ?? null,
      input.deliveryDeadlineExpression ?? null,
      input.maximumPublicationLatencyMinutes ?? null,
    ],
  );
  const row = rows[0];
  if (!row) throw new Error("Failed to create SLA policy");
  return row;
}

export async function findSlaPolicy(
  dataProductVersionId: string,
  client: pg.Pool | pg.PoolClient = pool,
): Promise<SlaPolicyRow | null> {
  const { rows } = await client.query<SlaPolicyRow>(`SELECT * FROM catalog.sla_policies WHERE data_product_version_id = $1`, [
    dataProductVersionId,
  ]);
  return rows[0] ?? null;
}
