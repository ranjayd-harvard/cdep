// Boundary for data-exchange-service's internal listing surface
// (GET /internal/v1/exchanges?direction=&limit=) — no since/cursor filter
// exists there, so this is polled with a generous limit and reconciled
// (plan section 3/9 reduction #1).
export interface ExchangeRecord {
  exchangeId: string;
  organizationId: string;
  tenantId: string;
  direction: "INBOUND" | "OUTBOUND";
  status: string;
  dataProductId: string;
  recordCount: number | null;
  errorCount: number | null;
  startedAt: Date | null;
  receivedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
}

export interface ExchangeClient {
  listRecent(params: { direction?: "INBOUND" | "OUTBOUND"; limit: number }): Promise<ExchangeRecord[]>;
}
