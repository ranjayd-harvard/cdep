import type {
  AdminExchangeIngestionRow,
  DataProductRow,
  LakehouseAdminService,
  LineageEdgeRow,
  PipelineRunDetail,
  PipelineRunRow,
  QualityResultRow,
  TriggerIngestionResult,
  TriggerPipelineResult,
} from "@/services/interfaces";
import { listExchangesInternal } from "@/lib/exchange-service/client";
import {
  getDataProductRows,
  getPipelineRunDetail,
  LakehouseServiceError,
  listDataProducts,
  listIngestionRunsByExchange,
  listPipelineRuns,
  triggerBronzeToSilver,
  triggerIngestion,
  triggerSilverToGold,
  type PipelineRunDTO,
} from "@/lib/lakehouse-service/client";

function toPipelineRunRow(run: PipelineRunDTO): PipelineRunRow {
  return {
    pipelineRunId: run.pipeline_run_id,
    pipelineName: run.pipeline_name,
    pipelineType: run.pipeline_type,
    organizationId: run.organization_id,
    tenantId: run.tenant_id,
    sourceTable: run.source_table,
    targetTable: run.target_table,
    sourceIngestionId: run.source_ingestion_id,
    sourcePipelineRunId: run.source_pipeline_run_id,
    dataProductId: run.data_product_id,
    status: run.status,
    inputRecordCount: run.input_record_count,
    outputRecordCount: run.output_record_count,
    rejectedRecordCount: run.rejected_record_count,
    startedAt: run.started_at,
    completedAt: run.completed_at,
    errorCode: run.error_code,
    errorMessage: run.error_message,
  };
}

export class LakehouseAdminApiService implements LakehouseAdminService {
  async listRecentExchangesWithIngestionStatus(limit = 50) {
    const { items } = await listExchangesInternal({ limit });

    // Per-exchange lookup (list_by_exchange, already exists in
    // data-lakehouse), not a join against a separately-windowed "recent
    // ingestion runs" list -- an exchange ingested a while back could fall
    // outside a small recent-runs window and wrongly show as "never
    // ingested". N+1 at this admin-page scale mirrors the existing
    // precedent in ExchangeApiExchangeService.getExchanges.
    const rows = await Promise.all(
      items.map(async (ex): Promise<AdminExchangeIngestionRow> => {
        const runs = await listIngestionRunsByExchange(ex.exchangeId).catch(() => []);
        const latest = runs.at(-1) ?? null; // list_by_exchange orders created_at ASC

        return {
          exchangeId: ex.exchangeId,
          organizationId: ex.organizationId,
          tenantId: ex.tenantId,
          direction: ex.direction,
          exchangeStatus: ex.status,
          dataProductId: ex.dataProductId,
          filename: ex.filename,
          createdAt: ex.createdAt,
          ingestion: latest
            ? {
                ingestionId: latest.ingestion_id,
                status: latest.status,
                bronzeTable: latest.bronze_table,
                sourceRecordCount: latest.source_record_count ?? 0,
                bronzeRecordCount: latest.bronze_record_count ?? 0,
                rejectedRecordCount: latest.rejected_record_count ?? 0,
                errorCode: latest.error_code,
                errorMessage: latest.error_message,
                completedAt: latest.completed_at,
              }
            : null,
        };
      }),
    );

    return { available: true, items: rows };
  }

  async triggerIngestion(exchangeId: string): Promise<TriggerIngestionResult> {
    try {
      const outcome = await triggerIngestion(exchangeId);
      return {
        ok: outcome.status !== "FAILED",
        status: outcome.status,
        errorCode: outcome.error_code ?? undefined,
        errorMessage: outcome.error_message ?? undefined,
      };
    } catch (err) {
      // A 404/409 from data-lakehouse is a client-fixable precondition
      // failure (exchange not found / not ready) -- surface it as a
      // non-throwing result so the Server Action can show a flash message
      // instead of a crash. Anything else (5xx/network) is genuinely
      // unexpected and should propagate.
      if (err instanceof LakehouseServiceError && (err.status === 404 || err.status === 409)) {
        return { ok: false, status: "FAILED", errorCode: err.code, errorMessage: err.message };
      }
      throw err;
    }
  }

  async listPipelineRuns(params?: { ingestionId?: string; sourcePipelineRunId?: string; limit?: number }) {
    try {
      const runs = await listPipelineRuns({
        ingestionId: params?.ingestionId,
        sourcePipelineRunId: params?.sourcePipelineRunId,
        limit: params?.limit,
      });
      return { available: true, items: runs.map(toPipelineRunRow) };
    } catch (err) {
      if (err instanceof LakehouseServiceError && err.code === "NOT_CONFIGURED") {
        return { available: false, items: [] };
      }
      throw err;
    }
  }

  async getPipelineRunDetail(pipelineRunId: string): Promise<PipelineRunDetail | null> {
    try {
      const detail = await getPipelineRunDetail(pipelineRunId);
      return {
        run: toPipelineRunRow(detail.run),
        qualityResults: detail.quality_results.map(
          (r): QualityResultRow => ({
            layer: r.layer,
            tableName: r.table_name,
            ruleName: r.rule_name,
            severity: r.severity,
            totalCount: r.total_count,
            failedCount: r.failed_count,
            failurePercentage: r.failure_percentage,
            passed: r.passed,
          }),
        ),
        lineageEdges: detail.lineage_edges.map(
          (e): LineageEdgeRow => ({
            sourceType: e.source_type,
            sourceIdentifier: e.source_identifier,
            targetType: e.target_type,
            targetIdentifier: e.target_identifier,
          }),
        ),
      };
    } catch (err) {
      if (err instanceof LakehouseServiceError && err.status === 404) {
        return null;
      }
      throw err;
    }
  }

  async triggerBronzeToSilver(ingestionId: string, reprocess = false): Promise<TriggerPipelineResult> {
    try {
      const outcome = await triggerBronzeToSilver(ingestionId, reprocess);
      return {
        ok: outcome.status !== "FAILED",
        outcomes: [
          {
            pipelineRunId: outcome.pipeline_run_id,
            status: outcome.status,
            outputRecordCount: outcome.output_record_count,
            rejectedRecordCount: outcome.rejected_record_count,
            errorCode: outcome.error_code ?? undefined,
            errorMessage: outcome.error_message ?? undefined,
          },
        ],
      };
    } catch (err) {
      if (err instanceof LakehouseServiceError && (err.status === 404 || err.status === 409)) {
        return { ok: false, outcomes: [], errorCode: err.code, errorMessage: err.message };
      }
      throw err;
    }
  }

  async triggerSilverToGold(
    silverRunId: string,
    productId?: string,
    reprocess = false,
  ): Promise<TriggerPipelineResult> {
    try {
      const outcomes = await triggerSilverToGold(silverRunId, productId, reprocess);
      return {
        ok: outcomes.every((o) => o.status !== "FAILED"),
        outcomes: outcomes.map((outcome) => ({
          pipelineRunId: outcome.pipeline_run_id,
          status: outcome.status,
          outputRecordCount: outcome.output_record_count,
          rejectedRecordCount: outcome.rejected_record_count,
          errorCode: outcome.error_code ?? undefined,
          errorMessage: outcome.error_message ?? undefined,
        })),
      };
    } catch (err) {
      if (err instanceof LakehouseServiceError && (err.status === 404 || err.status === 409)) {
        return { ok: false, outcomes: [], errorCode: err.code, errorMessage: err.message };
      }
      throw err;
    }
  }

  async listDataProducts(): Promise<{ available: boolean; items: DataProductRow[] }> {
    try {
      const products = await listDataProducts();
      return {
        available: true,
        items: products.map((p) => ({
          dataProductId: p.data_product_id,
          displayName: p.display_name,
          version: p.version,
          goldTable: p.gold_table,
          owner: p.owner,
          description: p.description,
          status: p.status,
        })),
      };
    } catch (err) {
      if (err instanceof LakehouseServiceError && err.code === "NOT_CONFIGURED") {
        return { available: false, items: [] };
      }
      throw err;
    }
  }

  async getDataProductRows(productId: string, limit = 100) {
    return getDataProductRows(productId, limit);
  }
}
