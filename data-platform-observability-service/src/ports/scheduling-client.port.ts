// Boundary for scheduling-service's /internal/scheduler/executions — the
// best-shaped internal API among the siblings (it supports a
// scheduled_from/scheduled_to time-range filter, so this adapter is the one
// exception that can poll incrementally rather than by generous limit
// alone). scheduled_execution.id is what this service calls scheduled_run_id.
export interface ScheduledExecutionRecord {
  scheduledRunId: string;
  subscriptionId: string;
  organizationId: string;
  tenantId: string;
  dataProductId: string;
  resolvedProductVersion: string | null;
  deliveryMethod: "FILE" | "API" | null;
  status: string;
  scheduledFor: Date | null;
  publicationId: string | null;
  failureCategory: string | null;
  failureCode: string | null;
}

export interface SchedulingClient {
  listExecutions(params: { scheduledFrom?: Date; scheduledTo?: Date; limit: number }): Promise<ScheduledExecutionRecord[]>;
}
