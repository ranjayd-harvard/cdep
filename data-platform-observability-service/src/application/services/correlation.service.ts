import type pg from "pg";
import { decideCorrelation, orderIdentifiersByPriority } from "../../domain/correlation.js";
import { generateCorrelationId, generateExecutionId } from "../../common/ids/id-generator.js";
import { logger } from "../../common/logger/logger.js";
import { env } from "../../config/env.js";
import type { IdentifierType } from "../../config/constants.js";
import type { EventEnvelope } from "../dto/event-envelope.dto.js";
import { extractIdentifiers } from "../dto/event-envelope.dto.js";
import {
  backfillProductVersionIfUnresolved,
  createExecution,
  findMostRecentOpenExecution,
  updateExecutionRollup,
} from "../../infrastructure/persistence/execution.repository.js";
import { findMatchedExecutionIds, upsertIdentifier } from "../../infrastructure/persistence/execution-identifier.repository.js";

export interface CorrelationResult {
  executionId: string;
  isNewExecution: boolean;
}

// Every identifier the join-key index tracks also has a same-named column
// denormalized directly onto operational_executions (migrations/001) for
// cheap direct reads (spec section 3/6) — the index is the correlation
// mechanism, this mapping is what keeps the row itself in sync with it.
const IDENTIFIER_TYPE_TO_EXECUTION_FIELD: Record<IdentifierType, string> = {
  INBOUND_EXCHANGE_ID: "inboundExchangeId",
  OUTBOUND_EXCHANGE_ID: "outboundExchangeId",
  INGESTION_ID: "ingestionId",
  SILVER_PIPELINE_RUN_ID: "silverPipelineRunId",
  GOLD_PIPELINE_RUN_ID: "goldPipelineRunId",
  PUBLICATION_ID: "publicationId",
  DELIVERY_REQUEST_ID: "deliveryRequestId",
  API_REQUEST_ID: "apiRequestId",
  SCHEDULED_RUN_ID: "scheduledRunId",
  SUBSCRIPTION_ID: "subscriptionId",
};

// Orchestrates the correlation decision (domain/correlation.ts) against the
// real join-key index and heuristic-fallback query (plan section 5). This
// is the one place an incoming event resolves which operational_executions
// row it belongs to — every event-ingestion path (push or poll) goes
// through here first.
export async function resolveOrCreateExecution(client: pg.Pool | pg.PoolClient, envelope: EventEnvelope): Promise<CorrelationResult> {
  const identifierValues = extractIdentifiers(envelope);
  const ordered = orderIdentifiersByPriority(identifierValues);

  const matchedExecutionIds = await findMatchedExecutionIds(client, ordered);

  const scope = {
    organizationId: envelope.context.organizationId,
    tenantId: envelope.context.tenantId,
    dataProductId: envelope.context.dataProductId,
    productVersion: envelope.context.productVersion,
  };

  const hasExactCandidate = ordered.some((id) => matchedExecutionIds.has(`${id.idType}:${id.idValue}`));
  const mostRecentOpenExecutionId = hasExactCandidate
    ? null
    : await findMostRecentOpenExecution(client, scope, env.CORRELATION_WINDOW_MINUTES);

  const decision = decideCorrelation({ identifiers: ordered, matchedExecutionIds, mostRecentOpenExecutionId });

  let executionId: string;
  let isNewExecution = false;

  if (decision.action === "CREATE") {
    executionId = generateExecutionId();
    await createExecution(client, {
      executionId,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      dataProductId: scope.dataProductId,
      productVersion: scope.productVersion,
      subscriptionId: envelope.context.subscriptionId ?? null,
      scheduledRunId: envelope.context.scheduledRunId ?? null,
      correlationId: envelope.correlation.correlationId ?? generateCorrelationId(),
    });
    isNewExecution = true;
    logger.info({ executionId, tenantId: scope.tenantId, dataProductId: scope.dataProductId }, "correlation.execution.created");
  } else {
    executionId = decision.executionId;
    if (decision.confidence === "HEURISTIC") {
      logger.info({ executionId, tenantId: scope.tenantId, dataProductId: scope.dataProductId }, "correlation.execution.attached.heuristic");
    }
    await backfillProductVersionIfUnresolved(client, executionId, envelope.context.productVersion);
  }

  // Denormalize every identifier this event carries directly onto the
  // execution row (spec section 3/6) — not just the join-key index —
  // whichever chain columns are still unset get filled in as the
  // execution progresses. Also covers subscription_id/scheduled_run_id for
  // the ATTACH path (e.g. the scheduling event arrives after an upstream
  // pipeline event already created the execution heuristically).
  const chainFields: Parameters<typeof updateExecutionRollup>[2] = {};
  for (const identifier of ordered) {
    const field = IDENTIFIER_TYPE_TO_EXECUTION_FIELD[identifier.idType];
    (chainFields as Record<string, string>)[field] = identifier.idValue;
  }
  if (Object.keys(chainFields).length > 0) {
    await updateExecutionRollup(client, executionId, chainFields);
  }

  const confidence = decision.action === "CREATE" ? "EXACT" : decision.confidence;
  for (const identifier of ordered) {
    await upsertIdentifier(client, { idType: identifier.idType, idValue: identifier.idValue, executionId, confidence });
  }

  return { executionId, isNewExecution };
}
