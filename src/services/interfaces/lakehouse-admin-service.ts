/**
 * Superadmin-only surface joining data-exchange-service's cross-tenant
 * exchange list with data-lakehouse's Bronze ingestion status — backs
 * `/admin/lakehouse`. Deliberately separate from `ExchangeService` (which
 * is tenant-scoped by contract): forcing a cross-tenant "list all" method
 * onto that interface would be unimplementable cleanly for its Mongo
 * implementation (tenant isolation there is a genuinely separate
 * collection per tenant). This mirrors data-exchange-service's own
 * precedent of keeping internal/admin surfaces structurally separate from
 * customer-facing ones.
 */
export interface AdminExchangeIngestionRow {
  exchangeId: string;
  organizationId: string;
  tenantId: string;
  direction: "INBOUND" | "OUTBOUND";
  exchangeStatus: string;
  dataProductId: string;
  filename: string | null;
  createdAt: string;
  /** null = this exchange has never been ingested. */
  ingestion: {
    ingestionId: string;
    status: string;
    bronzeTable: string | null;
    sourceRecordCount: number;
    bronzeRecordCount: number;
    rejectedRecordCount: number;
    errorCode: string | null;
    errorMessage: string | null;
    completedAt: string | null;
  } | null;
}

export interface TriggerIngestionResult {
  ok: boolean;
  status: string;
  errorCode?: string;
  errorMessage?: string;
}

/**
 * Phase 3: Bronze->Silver / Silver->Gold pipeline runs. Deliberately a
 * separate, flatter shape from AdminExchangeIngestionRow above — a pipeline
 * run isn't scoped to one exchange (Silver->Gold has no exchange at all).
 */
export interface PipelineRunRow {
  pipelineRunId: string;
  pipelineName: string;
  pipelineType: "BRONZE_TO_SILVER" | "SILVER_TO_GOLD";
  organizationId: string;
  tenantId: string;
  sourceTable: string;
  targetTable: string;
  sourceIngestionId: string | null;
  sourcePipelineRunId: string | null;
  dataProductId: string | null;
  status: string;
  inputRecordCount: number | null;
  outputRecordCount: number | null;
  rejectedRecordCount: number | null;
  startedAt: string;
  completedAt: string | null;
  errorCode: string | null;
  errorMessage: string | null;
}

export interface QualityResultRow {
  layer: string;
  tableName: string;
  ruleName: string;
  severity: string;
  totalCount: number;
  failedCount: number;
  failurePercentage: number;
  passed: boolean;
}

export interface LineageEdgeRow {
  sourceType: string;
  sourceIdentifier: string;
  targetType: string;
  targetIdentifier: string;
}

export interface PipelineRunDetail {
  run: PipelineRunRow;
  qualityResults: QualityResultRow[];
  lineageEdges: LineageEdgeRow[];
}

export interface TriggerPipelineResult {
  ok: boolean;
  outcomes: {
    pipelineRunId: string;
    status: string;
    outputRecordCount: number;
    rejectedRecordCount: number;
    errorCode?: string;
    errorMessage?: string;
  }[];
  errorCode?: string;
  errorMessage?: string;
}

export interface DataProductRow {
  dataProductId: string;
  displayName: string;
  version: string;
  goldTable: string;
  owner: string;
  description: string | null;
  status: string;
}

export interface LakehouseAdminService {
  listRecentExchangesWithIngestionStatus(limit?: number): Promise<{
    available: boolean;
    items: AdminExchangeIngestionRow[];
  }>;
  triggerIngestion(exchangeId: string): Promise<TriggerIngestionResult>;

  listPipelineRuns(params?: { ingestionId?: string; sourcePipelineRunId?: string; limit?: number }): Promise<{
    available: boolean;
    items: PipelineRunRow[];
  }>;
  getPipelineRunDetail(pipelineRunId: string): Promise<PipelineRunDetail | null>;
  triggerBronzeToSilver(ingestionId: string, reprocess?: boolean): Promise<TriggerPipelineResult>;
  triggerSilverToGold(
    silverRunId: string,
    productId?: string,
    reprocess?: boolean,
  ): Promise<TriggerPipelineResult>;

  listDataProducts(): Promise<{ available: boolean; items: DataProductRow[] }>;
  getDataProductRows(
    productId: string,
    limit?: number,
  ): Promise<Record<string, string | number | boolean | null>[]>;
}
