// Parses catalog's `deliveryDeadlineExpression` (spec sections 11-13).
//
// No grammar for this field exists anywhere else in the repo today — it is
// an unvalidated free-text string in catalog's contract schema with no
// example value in any example contract. Phase 9 defines exactly two
// concrete forms here (the pragmatic reduction from the implementation
// plan); anything else evaluates to NOT_APPLICABLE with a logged warning
// rather than crashing the SLA evaluator.
//
//   T+<n><unit>          relative to a reference time (e.g. the scheduled
//                        run's start, or the execution's first stage
//                        start). unit is m|h|d. Example: "T+4h".
//   daily HH:MM <tz>     an absolute local wall-clock deadline on the same
//                        calendar day as the reference time, in the given
//                        IANA time zone (or "UTC"). Example:
//                        "daily 06:00 UTC".
export type ParsedDeadlineExpression =
  | { kind: "RELATIVE"; amount: number; unit: "m" | "h" | "d" }
  | { kind: "DAILY"; hour: number; minute: number; timeZone: string };

const RELATIVE_PATTERN = /^T\+(\d+)(m|h|d)$/i;
const DAILY_PATTERN = /^daily\s+(\d{1,2}):(\d{2})\s+(\S+)$/i;

export function parseDeliveryDeadlineExpression(expression: string): ParsedDeadlineExpression | null {
  const trimmed = expression.trim();

  const relative = RELATIVE_PATTERN.exec(trimmed);
  if (relative) {
    return { kind: "RELATIVE", amount: Number(relative[1]), unit: relative[2]!.toLowerCase() as "m" | "h" | "d" };
  }

  const daily = DAILY_PATTERN.exec(trimmed);
  if (daily) {
    const hour = Number(daily[1]);
    const minute = Number(daily[2]);
    if (hour > 23 || minute > 59) return null;
    return { kind: "DAILY", hour, minute, timeZone: daily[3]! };
  }

  return null;
}

function unitToMs(unit: "m" | "h" | "d"): number {
  if (unit === "m") return 60_000;
  if (unit === "h") return 3_600_000;
  return 86_400_000;
}

// Resolves the UTC offset (in minutes, such that localTime = utcTime +
// offset) a given IANA time zone observes at `instant`, via a round-trip
// through Intl.DateTimeFormat — Node ships a full ICU build, so this needs
// no external tz-database dependency.
function timeZoneOffsetMinutes(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);

  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return (asUtc - instant.getTime()) / 60_000;
}

function calendarDateInZone(instant: Date, timeZone: string): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  return { year: get("year"), month: get("month"), day: get("day") };
}

// Computes the concrete UTC deadline instant for a parsed expression,
// relative to `referenceTime` (e.g. scheduled_for, or the execution's
// first stage start when no scheduled run triggered it).
export function computeDeadline(expression: ParsedDeadlineExpression, referenceTime: Date): Date {
  if (expression.kind === "RELATIVE") {
    return new Date(referenceTime.getTime() + expression.amount * unitToMs(expression.unit));
  }

  const { year, month, day } = calendarDateInZone(referenceTime, expression.timeZone);
  const naiveUtc = Date.UTC(year, month - 1, day, expression.hour, expression.minute, 0);
  const offsetMinutes = timeZoneOffsetMinutes(new Date(naiveUtc), expression.timeZone);
  return new Date(naiveUtc - offsetMinutes * 60_000);
}
