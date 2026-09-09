import { v7 as uuidv7 } from "uuid";
import { ID_PREFIXES } from "../../config/constants.js";

// Public identifiers are UUIDv7 (time-ordered) rendered without dashes,
// prefixed by resource type — mirrors subscription-service and
// data-product-catalog-service.
function generate(prefix: string): string {
  return `${prefix}-${uuidv7().replace(/-/g, "")}`;
}

export const generateProjectionId = () => generate(ID_PREFIXES.schedulerProjection);
export const generateExecutionId = () => generate(ID_PREFIXES.scheduledExecution);
export const generateDeadLetterId = () => generate(ID_PREFIXES.deadLetter);
export const generateAuditEventId = () => generate(ID_PREFIXES.auditEvent);
export const generateCorrelationId = () => generate(ID_PREFIXES.correlation);
