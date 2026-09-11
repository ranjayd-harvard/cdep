import type pg from "pg";
import type { OperationalStage } from "../../config/constants.js";
import { findExecutionById } from "../../infrastructure/persistence/execution.repository.js";
import { listStageRunsForExecution } from "../../infrastructure/persistence/stage-run.repository.js";
import { insertMetric } from "../../infrastructure/persistence/metric.repository.js";

// Derives per-stage latency, end-to-end pipeline latency, publication
// latency, and volume metrics (spec section 14) from the just-updated
// stage run. Deliberately writes only dimensional rows — no execution_id,
// matching migrations/005's design (high-cardinality ids never become
// metric rows/labels).
export async function evaluateMetricsForStage(client: pg.Pool | pg.PoolClient, executionId: string, stage: OperationalStage, now: Date): Promise<void> {
  const execution = await findExecutionById(client, executionId);
  if (!execution) return;

  const stageRuns = await listStageRunsForExecution(client, executionId);
  const run = stageRuns.find((r) => r.stage === stage);
  if (!run || !run.completedAt) return;

  const dims = {
    organizationId: execution.organizationId,
    tenantId: execution.tenantId,
    dataProductId: execution.dataProductId,
    productVersion: execution.productVersion,
  };

  if (run.startedAt) {
    await insertMetric(client, {
      metricName: "stage_latency_ms",
      ...dims,
      stage,
      deliveryMethod: null,
      timeWindowStart: run.startedAt,
      timeWindowEnd: run.completedAt,
      value: run.completedAt.getTime() - run.startedAt.getTime(),
      unit: "ms",
      dimensionsJson: { status: run.status },
    });
  }

  if (stage === "GOLD_PRODUCT_BUILD" && run.status === "SUCCEEDED") {
    const bronze = stageRuns.find((r) => r.stage === "BRONZE_INGESTION" && r.startedAt);
    if (bronze?.startedAt) {
      await insertMetric(client, {
        metricName: "pipeline_latency_ms",
        ...dims,
        stage: null,
        deliveryMethod: null,
        timeWindowStart: bronze.startedAt,
        timeWindowEnd: run.completedAt,
        value: run.completedAt.getTime() - bronze.startedAt.getTime(),
        unit: "ms",
        dimensionsJson: {},
      });
    }
  }

  if (stage === "PUBLICATION" && run.status === "SUCCEEDED" && run.startedAt) {
    await insertMetric(client, {
      metricName: "publication_latency_ms",
      ...dims,
      stage: "PUBLICATION",
      deliveryMethod: null,
      timeWindowStart: run.startedAt,
      timeWindowEnd: run.completedAt,
      value: run.completedAt.getTime() - run.startedAt.getTime(),
      unit: "ms",
      dimensionsJson: {},
    });
  }

  if (["OUTBOUND_EXCHANGE", "FILE_DELIVERY", "API_DELIVERY"].includes(stage) && run.status === "SUCCEEDED" && execution.startedAt) {
    await insertMetric(client, {
      metricName: "delivery_latency_ms",
      ...dims,
      stage,
      deliveryMethod: stage === "API_DELIVERY" ? "API" : "FILE",
      timeWindowStart: execution.startedAt,
      timeWindowEnd: run.completedAt,
      value: run.completedAt.getTime() - execution.startedAt.getTime(),
      unit: "ms",
      dimensionsJson: {},
    });
  }

  const outputRecordCount = run.metadataJson?.outputRecordCount ?? run.metadataJson?.bronzeRecordCount;
  if (typeof outputRecordCount === "number") {
    await insertMetric(client, {
      metricName: "records_processed",
      ...dims,
      stage,
      deliveryMethod: null,
      timeWindowStart: run.startedAt ?? run.completedAt,
      timeWindowEnd: run.completedAt,
      value: outputRecordCount,
      unit: "records",
      dimensionsJson: {},
    });
  }

  void now;
}
