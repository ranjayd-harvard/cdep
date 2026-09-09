import { AppError } from "../common/errors/app-error.js";
import type { DayOfWeek, DeliveryMethod, Frequency } from "../config/constants.js";

export interface DeliveryPreferenceInput {
  method: DeliveryMethod;
  format?: string | null;
  frequency: Frequency;
  deliveryTime?: string | null;
  timezone?: string | null;
  retentionDays?: number | null;
  apiProfile?: string | null;
  dayOfWeek?: DayOfWeek | null;
  cronExpression?: string | null;
}

export interface DeliveryPreference {
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
  version: number;
}

// IANA timezone validity check without an extra dependency — Intl throws
// RangeError on an unknown zone.
function isValidTimeZone(timezone: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)(:([0-5]\d))?$/;

// Domain-level shape validation only (spec §24-§26/§42) — independent of
// what the Catalog says a specific product/version actually supports.
// Catalog-format/method support is validated separately by the
// application layer via the catalog client (spec §24, "Catalog must
// remain authoritative").
export function validateDeliveryPreference(input: DeliveryPreferenceInput): void {
  if (input.method === "FILE") {
    if (!input.format) {
      throw new AppError("INVALID_DELIVERY_PREFERENCE", "FILE delivery requires a file_format.");
    }
    if (input.apiProfile) {
      throw new AppError("INVALID_DELIVERY_PREFERENCE", "api_profile is not valid for FILE delivery.");
    }
  }

  if (input.method === "API") {
    if (input.format) {
      throw new AppError("INVALID_DELIVERY_PREFERENCE", "file_format is not valid for API delivery.");
    }
  }

  if (input.frequency === "ON_DEMAND" && input.deliveryTime) {
    throw new AppError("INVALID_DELIVERY_PREFERENCE", "ON_DEMAND frequency must not specify a delivery_time.");
  }

  if (input.deliveryTime && !TIME_RE.test(input.deliveryTime)) {
    throw new AppError("INVALID_DELIVERY_PREFERENCE", `Invalid delivery_time '${input.deliveryTime}'. Expected HH:MM[:SS].`);
  }

  if (input.deliveryTime && !input.timezone) {
    throw new AppError("INVALID_DELIVERY_PREFERENCE", "delivery_time requires a timezone.");
  }

  if (input.timezone && !isValidTimeZone(input.timezone)) {
    throw new AppError("INVALID_DELIVERY_PREFERENCE", `Invalid IANA timezone '${input.timezone}'.`);
  }

  if (input.retentionDays !== undefined && input.retentionDays !== null && input.retentionDays <= 0) {
    throw new AppError("INVALID_DELIVERY_PREFERENCE", "retention_days must be greater than 0 when present.");
  }

  // Structural checks only — full cron semantic validation (occurrence
  // spacing, timezone-aware evaluation) is the Scheduler's job (scheduling-
  // service AGENTS.md section 20-21: "validate at the Subscription boundary
  // where possible and again defensively in Scheduler").
  if (input.frequency === "CRON") {
    if (!input.cronExpression) {
      throw new AppError("INVALID_DELIVERY_PREFERENCE", "CRON frequency requires cron_expression.");
    }
    if (input.cronExpression.trim().split(/\s+/).length !== 5) {
      throw new AppError("INVALID_DELIVERY_PREFERENCE", "cron_expression must have exactly 5 fields (minute hour day-of-month month day-of-week).");
    }
  } else if (input.cronExpression) {
    throw new AppError("INVALID_DELIVERY_PREFERENCE", "cron_expression is only valid for CRON frequency.");
  }

  if (input.dayOfWeek && input.frequency !== "WEEKLY") {
    throw new AppError("INVALID_DELIVERY_PREFERENCE", "day_of_week is only valid for WEEKLY frequency.");
  }
}
