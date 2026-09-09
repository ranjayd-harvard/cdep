import type {
  DayOfWeek,
  DeliveryMethod,
  ExecutionReason,
  ExecutionStatus,
  FailureCategory,
  IneligibilityReasonCode,
  ScheduleMode,
} from "../config/constants.js";

// Operational scheduling projection only (AGENTS.md section 10) — never
// Data Product/Product Version/entitlement/full subscription state.
export interface SchedulerProjection {
  id: string;
  subscriptionId: string;
  organizationId: string;
  tenantId: string;
  dataProductId: string;
  subscriptionStatus: string;
  scheduleMode: ScheduleMode;
  timezone: string | null;
  deliveryTimeLocal: string | null;
  dayOfWeek: DayOfWeek | null;
  cronExpression: string | null;
  nextRunAt: Date | null;
  lastReconciledAt: Date;
  subscriptionRevision: number;
  createdAt: Date;
  updatedAt: Date;
}

// The central execution record (AGENTS.md section 10/59) — one row per
// attempted scheduled occurrence or manual trigger. Retries mutate this
// row (attempt_count/next_retry_at/failure_*); they never create a second
// row for the same logical execution.
export interface ScheduledExecution {
  id: string;
  executionKey: string;
  subscriptionId: string;
  organizationId: string;
  tenantId: string;
  dataProductId: string;

  reason: ExecutionReason;
  scheduledFor: Date;
  triggeredAt: Date | null;

  requestedVersionPolicyType: string | null;
  requestedVersionPolicyValue: string | null;
  resolvedProductVersion: string | null;

  deliveryMethod: DeliveryMethod | null;
  format: string | null;

  status: ExecutionStatus;

  attemptCount: number;
  maxAttempts: number;
  nextRetryAt: Date | null;

  publicationRequestId: string | null;
  publicationId: string | null;

  failureCategory: FailureCategory | null;
  failureCode: string | null;
  failureMessage: string | null;
  ineligibilityReasonCode: IneligibilityReasonCode | null;

  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
}

export interface DeadLetterRecord {
  id: string;
  executionId: string;
  subscriptionId: string;
  organizationId: string;
  tenantId: string;
  failureCategory: FailureCategory | null;
  failureCode: string | null;
  failureMessage: string | null;
  attemptCount: number;
  payloadSnapshot: Record<string, unknown>;
  deadLetteredAt: Date;
  resolvedAt: Date | null;
  resolutionNote: string | null;
}
