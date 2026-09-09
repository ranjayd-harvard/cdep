import { v7 as uuidv7 } from "uuid";
import { ID_PREFIXES } from "../../config/constants.js";

function generate(prefix: string): string {
  return `${prefix}-${uuidv7().replace(/-/g, "")}`;
}

export const generateCorrelationId = () => generate(ID_PREFIXES.correlation);
