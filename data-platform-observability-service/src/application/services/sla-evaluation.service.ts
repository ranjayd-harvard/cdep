import type pg from "pg";
import { defaultStageTargetMinutes } from "../../config/env.js";
import type { OperationalStage, SlaStatus } from "../../config/constants.js";
import { evaluateBusinessSla, evaluateStageTarget, rollupSlaStatus } from "../../domain/sla/sla-evaluator.js";
import { generateSlaDefinitionId, generateSlaEvaluationId } from "../../common/ids/id-generator.js";
import { findExecutionById, updateExecutionRollup, type OperationalExecutionRow } from "../../infrastructure/persistence/execution.repository.js";
import { listStageRunsForExecution, type StageRunRow } from "../../infrastructure/persistence/stage-run.repository.js";
import { findActiveDefinition, upsertDefinitionIfChanged, type SlaDefinitionRow } from "../../infrastructure/persistence/sla-definition.repository.js";
import { upsertEvaluation } from "../../infrastructure/persistence/sla-evaluation.repository.js";
import { increment } from "../../telemetry/metrics-registry.js";

const DELIVERY_STAGES: readonly OperationalStage[] = ["OUTBOUND_EXCHANGE", "FILE_DELIVERY", "API_DELIVERY"];

async function findOrSeedStageTarget(
  client: pg.Pool | pg.PoolClient,
  dataProductId: string,
  productVersion: string,
  stage: OperationalStage,
  now: Date,
): Promise<SlaDefinitionRow> {
  const existing = await findActiveDefinition(client, { dataProductId, productVersion, slaType: "STAGE_TARGET", stage, at: now });
  if (existing) return existing;

  // Phase-9-owned default (catalog declares nothing per-stage) — seeded on
  // first use so history exists for the very first evaluation too.
  return upsertDefinitionIfChanged(client, {
    newId: generateSlaDefinitionId(),
    dataProductId,
    productVersion,
    slaType: "STAGE_TARGET",
    stage,
    catalogReference: null,
    target: { targetMinutes: defaultStageTargetMinutes(stage) },
    now,
  });
}

// The earliest timestamp this service actually has on record for the
// execution, from the stage run data itself (startedAt if a true start was
// observed, otherwise completedAt — a stage first observed already
// terminal still has a real completedAt) — never wall-clock "now".
function earliestKnownTime(stageRuns: readonly StageRunRow[]): Date | null {
  const candidates = stageRuns.flatMap((r) => [r.startedAt, r.completedAt]).filter((d): d is Date => d !== null);
  if (candidates.length === 0) return null;
  return candidates.reduce((min, d) => (d < min ? d : min));
}

function firstCompletedAmong(stageRuns: readonly StageRunRow[], stages: readonly OperationalStage[]): Date | null {
  for (const stage of stages) {
    const run = stageRuns.find((r) => r.stage === stage && r.status === "SUCCEEDED" && r.completedAt);
    if (run?.completedAt) return run.completedAt;
  }
  return null;
}

export interface SlaEvaluationOutcome {
  technicalStatus: SlaStatus;
  businessStatus: SlaStatus;
}

// Evaluates both technical (per-stage target) and business (customer
// delivery deadline) SLA for one execution, persisting every evaluation
// (history is never overwritten — spec section 40) and rolling the results
// up onto operational_executions.{technical,business}_sla_status.
export async function evaluateSlaForExecution(client: pg.Pool | pg.PoolClient, executionId: string, now: Date): Promise<SlaEvaluationOutcome | null> {
  const execution = await findExecutionById(client, executionId);
  if (!execution) return null;

  const stageRuns = await listStageRunsForExecution(client, executionId);

  const technicalStatuses: SlaStatus[] = [];
  for (const run of stageRuns) {
    const definition = await findOrSeedStageTarget(client, execution.dataProductId, execution.productVersion, run.stage, now);
    const targetMinutes = Number((definition.target as { targetMinutes: number }).targetMinutes);
    const result = evaluateStageTarget({ targetMinutes, actualStartedAt: run.startedAt, actualCompletedAt: run.completedAt }, now);
    technicalStatuses.push(result.status);

    await upsertEvaluation(client, {
      slaEvaluationId: generateSlaEvaluationId(),
      executionId,
      slaDefinitionId: definition.slaDefinitionId,
      organizationId: execution.organizationId,
      tenantId: execution.tenantId,
      dataProductId: execution.dataProductId,
      productVersion: execution.productVersion,
      slaType: "STAGE_TARGET",
      stage: run.stage,
      status: result.status,
      targetValue: result.targetValue,
      actualValue: result.actualValue,
      breachDurationSeconds: result.breachDurationSeconds,
    });
  }

  const technicalStatus = rollupSlaStatus(technicalStatuses);

  const businessDefinition = await findActiveDefinition(client, {
    dataProductId: execution.dataProductId,
    productVersion: execution.productVersion,
    slaType: "BUSINESS",
    stage: null,
    at: now,
  });

  let businessStatus: SlaStatus = "NOT_APPLICABLE";
  if (businessDefinition) {
    const expression = (businessDefinition.target as { deliveryDeadlineExpression?: string }).deliveryDeadlineExpression;
    if (expression) {
      // execution.startedAt is frequently null (a stage first observed
      // already in a terminal state — e.g. polling caught it after the
      // fact — never fabricates a start time, see domain/execution.ts).
      // Falling back to evaluation wall-clock "now" would anchor a
      // deadline expression like "daily 06:00 UTC" to whatever moment the
      // evaluator happens to run (arbitrarily wrong for a reconciliation
      // replay of an old event, or simply this execution's very first,
      // already-terminal observation). The earliest timestamp actually on
      // record in the stage run data — falling back to this row's own
      // created_at only if truly nothing else is known yet — is a
      // data-anchored reference instead.
      const referenceTime = execution.startedAt ?? earliestKnownTime(stageRuns) ?? execution.createdAt;
      const actualAvailableAt = firstCompletedAmong(stageRuns, DELIVERY_STAGES);
      const result = evaluateBusinessSla({ deliveryDeadlineExpression: expression, referenceTime, actualAvailableAt }, now);
      businessStatus = result.status;
      if (result.status === "FAIL") increment("sla_breach_total");

      await upsertEvaluation(client, {
        slaEvaluationId: generateSlaEvaluationId(),
        executionId,
        slaDefinitionId: businessDefinition.slaDefinitionId,
        organizationId: execution.organizationId,
        tenantId: execution.tenantId,
        dataProductId: execution.dataProductId,
        productVersion: execution.productVersion,
        slaType: "BUSINESS",
        stage: null,
        status: result.status,
        targetValue: result.targetValue,
        actualValue: result.actualValue,
        breachDurationSeconds: result.breachDurationSeconds,
      });
    }
  }

  await updateExecutionRollup(client, executionId, { technicalSlaStatus: technicalStatus, businessSlaStatus: businessStatus });

  return { technicalStatus, businessStatus };
}

export type { OperationalExecutionRow };
