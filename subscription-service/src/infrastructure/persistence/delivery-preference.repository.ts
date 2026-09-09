import { AppError } from "../../common/errors/app-error.js";
import type { DayOfWeek, DeliveryMethod, Frequency } from "../../config/constants.js";
import type { DeliveryPreference } from "../../domain/delivery-preference.js";
import type { Queryable } from "./queryable.js";

interface DeliveryPreferenceRow {
  delivery_preference_id: string;
  subscription_id: string;
  delivery_method: DeliveryMethod;
  file_format: string | null;
  frequency: Frequency;
  delivery_time: string | null;
  timezone: string | null;
  retention_days: number | null;
  api_profile: string | null;
  configuration: { dayOfWeek?: DayOfWeek | null; cronExpression?: string | null } | null;
  version: string | number;
}

// day_of_week/cron_expression (Phase 7 additions) ride inside the
// pre-existing, previously-unused `configuration` JSONB column rather than
// requiring a schema migration — kept as a small, explicitly-shaped
// sub-object rather than a grab-bag, since this column has no other users.
function mapRow(row: DeliveryPreferenceRow): DeliveryPreference {
  return {
    deliveryPreferenceId: row.delivery_preference_id,
    subscriptionId: row.subscription_id,
    method: row.delivery_method,
    format: row.file_format,
    frequency: row.frequency,
    deliveryTime: row.delivery_time,
    timezone: row.timezone,
    retentionDays: row.retention_days,
    apiProfile: row.api_profile,
    dayOfWeek: row.configuration?.dayOfWeek ?? null,
    cronExpression: row.configuration?.cronExpression ?? null,
    version: Number(row.version),
  };
}

export async function findDeliveryPreferenceBySubscription(
  db: Queryable,
  subscriptionId: string,
): Promise<DeliveryPreference | null> {
  const { rows } = await db.query<DeliveryPreferenceRow>(
    `SELECT * FROM subscription_delivery_preferences WHERE subscription_id = $1`,
    [subscriptionId],
  );
  return rows[0] ? mapRow(rows[0]) : null;
}

export interface InsertDeliveryPreferenceInput {
  deliveryPreferenceId: string;
  subscriptionId: string;
  method: DeliveryMethod;
  format: string | null;
  frequency: Frequency;
  deliveryTime: string | null;
  timezone: string | null;
  retentionDays: number | null;
  apiProfile: string | null;
  dayOfWeek: DayOfWeek | null;
  cronExpression: string | null;
}

export async function insertDeliveryPreference(
  db: Queryable,
  input: InsertDeliveryPreferenceInput,
): Promise<DeliveryPreference> {
  const { rows } = await db.query<DeliveryPreferenceRow>(
    `INSERT INTO subscription_delivery_preferences (
       delivery_preference_id, subscription_id, delivery_method, file_format,
       frequency, delivery_time, timezone, retention_days, api_profile, configuration
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [
      input.deliveryPreferenceId,
      input.subscriptionId,
      input.method,
      input.format,
      input.frequency,
      input.deliveryTime,
      input.timezone,
      input.retentionDays,
      input.apiProfile,
      JSON.stringify({ dayOfWeek: input.dayOfWeek, cronExpression: input.cronExpression }),
    ],
  );
  return mapRow(rows[0] as DeliveryPreferenceRow);
}

export interface UpdateDeliveryPreferenceInput extends InsertDeliveryPreferenceInput {
  expectedVersion: number;
}

export async function updateDeliveryPreference(
  db: Queryable,
  input: UpdateDeliveryPreferenceInput,
): Promise<DeliveryPreference> {
  const { rows } = await db.query<DeliveryPreferenceRow>(
    `UPDATE subscription_delivery_preferences SET
       delivery_method = $1, file_format = $2, frequency = $3, delivery_time = $4,
       timezone = $5, retention_days = $6, api_profile = $7, configuration = $8,
       updated_at = now(), version = version + 1
     WHERE subscription_id = $9 AND version = $10
     RETURNING *`,
    [
      input.method,
      input.format,
      input.frequency,
      input.deliveryTime,
      input.timezone,
      input.retentionDays,
      input.apiProfile,
      JSON.stringify({ dayOfWeek: input.dayOfWeek, cronExpression: input.cronExpression }),
      input.subscriptionId,
      input.expectedVersion,
    ],
  );
  if (rows.length === 0) {
    throw new AppError(
      "CONCURRENT_MODIFICATION",
      `Delivery preference for subscription '${input.subscriptionId}' was modified concurrently.`,
    );
  }
  return mapRow(rows[0] as DeliveryPreferenceRow);
}
