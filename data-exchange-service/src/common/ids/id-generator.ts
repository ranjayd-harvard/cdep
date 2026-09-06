import { v7 as uuidv7 } from "uuid";
import { ID_PREFIXES } from "../../config/constants.js";

// Public identifiers are UUIDv7 (time-ordered, non-sequential in the
// database-index sense) rendered without dashes, prefixed by resource type.
// Internal database identity remains the VARCHAR primary key itself — there
// is no separate sequential surrogate key to leak.
function generate(prefix: string): string {
  return `${prefix}-${uuidv7().replace(/-/g, "")}`;
}

export const generateExchangeId = () => generate(ID_PREFIXES.exchange);
export const generateFileId = () => generate(ID_PREFIXES.file);
export const generateEventId = () => generate(ID_PREFIXES.event);
export const generateValidationId = () => generate(ID_PREFIXES.validation);
export const generateCorrelationId = () => generate(ID_PREFIXES.correlation);
