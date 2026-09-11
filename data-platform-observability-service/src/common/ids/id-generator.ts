import { v7 as uuidv7 } from "uuid";
import { ID_PREFIXES } from "../../config/constants.js";

// Public identifiers are UUIDv7 (time-ordered) rendered without dashes,
// prefixed by resource type — mirrors every TS sibling (subscription-service,
// scheduling-service, data-product-catalog-service).
function generate(prefix: string): string {
  return `${prefix}-${uuidv7().replace(/-/g, "")}`;
}

export const generateExecutionId = () => generate(ID_PREFIXES.execution);
export const generateStageRunId = () => generate(ID_PREFIXES.stageRun);
// Used only for internally-synthesized envelopes (reconciliation repairs) —
// events arriving via POST /v1/events or a poller carry the source
// service's own idempotent event id instead, never a generated one.
export const generateEventId = () => generate(ID_PREFIXES.event);
export const generateSlaDefinitionId = () => generate(ID_PREFIXES.slaDefinition);
export const generateSlaEvaluationId = () => generate(ID_PREFIXES.slaEvaluation);
export const generateAlertId = () => generate(ID_PREFIXES.alert);
export const generateIncidentId = () => generate(ID_PREFIXES.incident);
export const generateMaintenanceWindowId = () => generate(ID_PREFIXES.maintenanceWindow);
export const generateReconciliationRunId = () => generate(ID_PREFIXES.reconciliationRun);
export const generateCorrelationId = () => generate(ID_PREFIXES.correlation);
