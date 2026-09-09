import { AppError } from "../common/errors/app-error.js";
import { DAYS_OF_WEEK, type DayOfWeek } from "../config/constants.js";

// Zone-aware wall-clock <-> UTC conversion (AGENTS.md sections 16-18).
// Node has no built-in "construct a Date from local wall-clock fields in an
// arbitrary IANA zone" primitive before Temporal, so this implements the
// standard two-pass offset-guess-and-correct technique (the same approach
// date-fns-tz/moment-timezone use), plus explicit, tested policies for the
// two DST edge cases:
//
//   - Spring-forward gap (the requested local time never occurs): execute
//     at the next valid local instant, found by stepping the wall-clock
//     target forward minute by minute and re-resolving until a UTC instant
//     reformats back to exactly that wall time.
//   - Fall-back overlap (the requested local time occurs twice): the
//     two-pass algorithm converges on the offset in effect at the
//     *earlier* candidate UTC instant, so it deterministically resolves to
//     the first (pre-transition) occurrence — executing once, not twice.

export interface WallTime {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone });
    return true;
  } catch {
    return false;
  }
}

const partsFormatterCache = new Map<string, Intl.DateTimeFormat>();
function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let fmt = partsFormatterCache.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      weekday: "short",
    });
    partsFormatterCache.set(timeZone, fmt);
  }
  return fmt;
}

function wallTimeAt(utcMillis: number, timeZone: string): WallTime & { weekday: string } {
  const parts = partsFormatter(timeZone).formatToParts(new Date(utcMillis));
  const map: Record<string, string> = {};
  for (const p of parts) if (p.type !== "literal") map[p.type] = p.value;
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour === "24" ? "0" : map.hour),
    minute: Number(map.minute),
    second: Number(map.second),
    weekday: map.weekday ?? "",
  };
}

function offsetMinutesAt(utcMillis: number, timeZone: string): number {
  const w = wallTimeAt(utcMillis, timeZone);
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  return (asUtc - utcMillis) / 60_000;
}

function wallEquals(a: WallTime, b: WallTime): boolean {
  return a.year === b.year && a.month === b.month && a.day === b.day && a.hour === b.hour && a.minute === b.minute && a.second === b.second;
}

function addMinutes(wall: WallTime, minutes: number): WallTime {
  const asUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second) + minutes * 60_000;
  const d = new Date(asUtc);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    second: d.getUTCSeconds(),
  };
}

// Bounds the spring-forward gap-search loop. Real-world DST gaps are at
// most a couple of hours; 360 minutes is a generous, cheap safety margin.
const MAX_GAP_SEARCH_MINUTES = 360;

function resolveOnce(wall: WallTime, timeZone: string): Date {
  const naiveUtcMillis = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
  const offsetGuess = offsetMinutesAt(naiveUtcMillis, timeZone);
  const candidate = naiveUtcMillis - offsetGuess * 60_000;
  const offsetAtCandidate = offsetMinutesAt(candidate, timeZone);
  const candidate2 = naiveUtcMillis - offsetAtCandidate * 60_000;
  return new Date(candidate2);
}

// Converts a local wall-clock time in an IANA zone to the correct UTC
// instant, applying the documented DST policy above.
export function zonedWallTimeToUtc(wall: WallTime, timeZone: string): Date {
  if (!isValidTimeZone(timeZone)) {
    throw new AppError("INVALID_SCHEDULE_CONFIG", `Invalid IANA timezone '${timeZone}'.`);
  }

  const resolved = resolveOnce(wall, timeZone);
  const reformatted = wallTimeAt(resolved.getTime(), timeZone);
  if (wallEquals(wall, reformatted)) {
    return resolved;
  }

  // Spring-forward gap: the requested wall time doesn't exist. Step
  // forward until we find the next wall-clock minute that resolves back to
  // itself (i.e. is a real, unambiguous local instant), and use that.
  for (let step = 1; step <= MAX_GAP_SEARCH_MINUTES; step++) {
    const steppedWall = addMinutes(wall, step);
    const steppedResolved = resolveOnce(steppedWall, timeZone);
    const steppedReformatted = wallTimeAt(steppedResolved.getTime(), timeZone);
    if (wallEquals(steppedWall, steppedReformatted)) {
      return steppedResolved;
    }
  }

  throw new AppError("INTERNAL_ERROR", `Could not resolve local time in zone '${timeZone}' near a DST transition.`);
}

export function dayOfWeekInZone(date: Date, timeZone: string): DayOfWeek {
  const weekday = wallTimeAt(date.getTime(), timeZone).weekday.toUpperCase();
  const map: Record<string, DayOfWeek> = {
    MON: "MONDAY",
    TUE: "TUESDAY",
    WED: "WEDNESDAY",
    THU: "THURSDAY",
    FRI: "FRIDAY",
    SAT: "SATURDAY",
    SUN: "SUNDAY",
  };
  const result = map[weekday.slice(0, 3)];
  if (!result) throw new AppError("INTERNAL_ERROR", `Could not determine weekday for ${date.toISOString()} in ${timeZone}.`);
  return result;
}

export function calendarDateInZone(date: Date, timeZone: string): { year: number; month: number; day: number } {
  const w = wallTimeAt(date.getTime(), timeZone);
  return { year: w.year, month: w.month, day: w.day };
}

export function daysUntil(from: DayOfWeek, to: DayOfWeek): number {
  const fromIndex = DAYS_OF_WEEK.indexOf(from);
  const toIndex = DAYS_OF_WEEK.indexOf(to);
  return (toIndex - fromIndex + 7) % 7;
}

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/;

export function parseDeliveryTimeLocal(value: string): { hour: number; minute: number; second: number } {
  const match = TIME_RE.exec(value);
  if (!match) {
    throw new AppError("INVALID_SCHEDULE_CONFIG", `Invalid delivery_time '${value}'. Expected HH:MM[:SS].`);
  }
  return { hour: Number(match[1]), minute: Number(match[2]), second: Number(match[3] ?? "0") };
}
