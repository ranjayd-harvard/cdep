// The trusted internal request the Scheduler hands to Publication Service
// (AGENTS.md section 31/33). Constructed entirely from server-side
// resolved state — never from arbitrary client input (no customer-
// controlled storage path, Gold table path, snapshot, or file name).
export interface PublicationRequestDTO {
  executionId: string;
  subscriptionId: string;
  organizationId: string;
  tenantId: string;
  dataProductId: string;
  requestedVersionPolicy: { type: string; value: string | null };
  resolvedProductVersion: string;
  deliveryMethod: string;
  format: string | null;
  reason: "SCHEDULED" | "MANUAL" | "ON_DEMAND" | "MISSED_RUN_RECOVERY" | "RETRY";
  scheduledFor: string;
  idempotencyKey: string;
}
