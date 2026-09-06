import type {
  PublicationAdminService,
  PublicationArtifactRow,
  PublicationQualityResultRow,
  PublicationRunDetail,
  PublicationRunRow,
  TriggerPublishResult,
} from "@/services/interfaces";
import {
  getPublication,
  listPublications,
  PublicationServiceError,
  triggerPublish,
  type PublicationRunDTO,
} from "@/lib/publication-service/client";

function toPublicationRunRow(run: PublicationRunDTO): PublicationRunRow {
  return {
    publicationId: run.publication_id,
    organizationId: run.organization_id,
    tenantId: run.tenant_id,
    dataProductId: run.data_product_id,
    productVersion: run.product_version,
    sourceGoldTable: run.source_gold_table,
    sourceGoldSnapshotId: run.source_gold_snapshot_id,
    sourcePipelineRunId: run.source_pipeline_run_id,
    requestedFormat: run.requested_format,
    status: run.status,
    inputRecordCount: run.input_record_count,
    outputRecordCount: run.output_record_count,
    artifactCount: run.artifact_count,
    outboundExchangeId: run.outbound_exchange_id,
    startedAt: run.started_at,
    completedAt: run.completed_at,
    errorCode: run.error_code,
    errorMessage: run.error_message,
    createdAt: run.created_at,
  };
}

export class PublicationAdminApiService implements PublicationAdminService {
  async listPublications(limit = 50): Promise<{ available: boolean; items: PublicationRunRow[] }> {
    try {
      const runs = await listPublications(limit);
      return { available: true, items: runs.map(toPublicationRunRow) };
    } catch (err) {
      if (err instanceof PublicationServiceError && err.code === "NOT_CONFIGURED") {
        return { available: false, items: [] };
      }
      throw err;
    }
  }

  async getPublicationDetail(publicationId: string): Promise<PublicationRunDetail | null> {
    try {
      const detail = await getPublication(publicationId);
      return {
        run: toPublicationRunRow(detail.run),
        artifacts: detail.artifacts.map(
          (a): PublicationArtifactRow => ({
            artifactId: a.artifact_id,
            filename: a.filename,
            format: a.format,
            contentType: a.content_type,
            compression: a.compression,
            sizeBytes: a.size_bytes,
            checksumAlgorithm: a.checksum_algorithm,
            checksum: a.checksum,
            recordCount: a.record_count,
          }),
        ),
        qualityResults: detail.quality_results.map(
          (q): PublicationQualityResultRow => ({
            ruleName: q.rule_name,
            severity: q.severity,
            totalCount: q.total_count,
            failedCount: q.failed_count,
            passed: q.passed,
          }),
        ),
      };
    } catch (err) {
      if (err instanceof PublicationServiceError && err.status === 404) {
        return null;
      }
      throw err;
    }
  }

  async triggerPublish(pipelineRunId: string, format?: string, republish = false): Promise<TriggerPublishResult> {
    try {
      const outcome = await triggerPublish(pipelineRunId, format, republish);
      return {
        ok: outcome.status !== "FAILED",
        publicationId: outcome.publication_id,
        status: outcome.status,
        outboundExchangeId: outcome.outbound_exchange_id,
        outputRecordCount: outcome.output_record_count,
        errorCode: outcome.error_code ?? undefined,
        errorMessage: outcome.error_message ?? undefined,
      };
    } catch (err) {
      if (err instanceof PublicationServiceError && (err.status === 404 || err.status === 409)) {
        return { ok: false, errorCode: err.code, errorMessage: err.message };
      }
      throw err;
    }
  }
}
