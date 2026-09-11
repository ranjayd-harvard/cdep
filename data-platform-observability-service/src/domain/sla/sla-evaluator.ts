import type { SlaStatus } from "../../config/constants.js";
import { computeDeadline, parseDeliveryDeadlineExpression } from "./sla-expression.js";

export interface SlaEvaluationResult {
  status: SlaStatus;
  targetValue: Record<string, unknown>;
  actualValue: Record<string, unknown>;
  breachDurationSeconds: number | null;
}

// Technical SLA: did a single stage complete within its declared/default
// target duration (spec section 10)? AT_RISK covers a stage still RUNNING
// past its target with no completion yet.
export function evaluateStageTarget(
  input: { targetMinutes: number; actualStartedAt: Date | null; actualCompletedAt: Date | null },
  now: Date,
): SlaEvaluationResult {
  const targetValue = { targetMinutes: input.targetMinutes };

  if (!input.actualStartedAt) {
    return { status: "UNKNOWN", targetValue, actualValue: {}, breachDurationSeconds: null };
  }

  const targetMs = input.targetMinutes * 60_000;

  if (input.actualCompletedAt) {
    const durationMs = input.actualCompletedAt.getTime() - input.actualStartedAt.getTime();
    const breachMs = durationMs - targetMs;
    return {
      status: breachMs <= 0 ? "PASS" : "FAIL",
      targetValue,
      actualValue: { actualMinutes: durationMs / 60_000 },
      breachDurationSeconds: breachMs > 0 ? Math.round(breachMs / 1000) : null,
    };
  }

  const elapsedMs = now.getTime() - input.actualStartedAt.getTime();
  if (elapsedMs > targetMs) {
    return {
      status: "AT_RISK",
      targetValue,
      actualValue: { elapsedMinutes: elapsedMs / 60_000 },
      breachDurationSeconds: Math.round((elapsedMs - targetMs) / 1000),
    };
  }

  return { status: "UNKNOWN", targetValue, actualValue: { elapsedMinutes: elapsedMs / 60_000 }, breachDurationSeconds: null };
}

// Business SLA: did the product become customer-available by the promised
// delivery deadline (spec section 11)? referenceTime is the scheduled run's
// start (or the execution's own first-stage start for an ad hoc run).
export function evaluateBusinessSla(
  input: { deliveryDeadlineExpression: string; referenceTime: Date; actualAvailableAt: Date | null },
  now: Date,
  atRiskWindowMinutes = 15,
): SlaEvaluationResult {
  const parsed = parseDeliveryDeadlineExpression(input.deliveryDeadlineExpression);
  if (!parsed) {
    return {
      status: "NOT_APPLICABLE",
      targetValue: { expression: input.deliveryDeadlineExpression, unparseable: true },
      actualValue: {},
      breachDurationSeconds: null,
    };
  }

  const deadline = computeDeadline(parsed, input.referenceTime);
  const targetValue = { expression: input.deliveryDeadlineExpression, deadline: deadline.toISOString() };

  if (input.actualAvailableAt) {
    const diffMs = input.actualAvailableAt.getTime() - deadline.getTime();
    return {
      status: diffMs <= 0 ? "PASS" : "FAIL",
      targetValue,
      actualValue: { availableAt: input.actualAvailableAt.toISOString() },
      breachDurationSeconds: diffMs > 0 ? Math.round(diffMs / 1000) : null,
    };
  }

  const remainingMs = deadline.getTime() - now.getTime();
  if (remainingMs < 0) {
    return {
      status: "FAIL",
      targetValue,
      actualValue: { availableAt: null },
      breachDurationSeconds: Math.round(-remainingMs / 1000),
    };
  }
  if (remainingMs <= atRiskWindowMinutes * 60_000) {
    return { status: "AT_RISK", targetValue, actualValue: { availableAt: null }, breachDurationSeconds: null };
  }
  return { status: "UNKNOWN", targetValue, actualValue: { availableAt: null }, breachDurationSeconds: null };
}

// Rolls up several individual SLA evaluations (e.g. one per stage) into a
// single execution-level status — FAIL dominates, then AT_RISK, then
// UNKNOWN, PASS only when everything evaluated has passed.
export function rollupSlaStatus(statuses: readonly SlaStatus[]): SlaStatus {
  const applicable = statuses.filter((s) => s !== "NOT_APPLICABLE");
  if (applicable.length === 0) return "NOT_APPLICABLE";
  if (applicable.includes("FAIL")) return "FAIL";
  if (applicable.includes("AT_RISK")) return "AT_RISK";
  if (applicable.includes("UNKNOWN")) return "UNKNOWN";
  return "PASS";
}
