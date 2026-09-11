// Boundary for data-publication-service's /internal/v1/publications — no
// since/cursor filter exists there either (plan section 9 reduction #1);
// generous limit + event-id dedup + reconciliation is the correctness
// backstop.
export interface PublicationRunRecord {
  publicationId: string;
  organizationId: string;
  tenantId: string;
  dataProductId: string;
  productVersion: string;
  sourcePipelineRunId: string | null;
  status: string;
  outboundExchangeId: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  inputRecordCount: number | null;
  outputRecordCount: number | null;
  errorCode: string | null;
  errorMessage: string | null;
}

export interface PublicationClient {
  listRecent(limit: number): Promise<PublicationRunRecord[]>;
}
