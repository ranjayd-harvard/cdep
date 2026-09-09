// Port for the Publication Service integration boundary (AGENTS.md section
// 32-33). The Scheduler never generates a Gold path, snapshot, or file
// name — it hands Publication Service a trusted (org, tenant, product,
// Catalog-resolved version) scope plus its own deterministic idempotency
// key, and Publication Service remains solely responsible for resolving
// and safely publishing that scope's Gold data.
export interface PublicationTriggerRequest {
  organizationId: string;
  tenantId: string;
  dataProductId: string;
  productVersion: string;
  format: string | null;
  externalIdempotencyKey: string;
}

export type PublicationOutcomeStatus = "READY" | "FAILED" | "SKIPPED_DUPLICATE";

export interface PublicationTriggerOutcome {
  publicationId: string;
  status: PublicationOutcomeStatus;
  outboundExchangeId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
}

export interface PublicationClient {
  trigger(request: PublicationTriggerRequest): Promise<PublicationTriggerOutcome>;
}
