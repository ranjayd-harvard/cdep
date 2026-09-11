import pino from "pino";
import { env } from "../../config/env.js";

// Never logs full request/response payloads or customer datasets (spec
// section 29) — call sites log organization_id/tenant_id/data_product_id/
// product_version/execution_id/stage/correlation_id instead.
export const logger = pino({
  level: env.LOG_LEVEL,
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers['x-internal-api-key']",
      "*.token",
      "*.metadata_json",
      "*.metadataJson",
    ],
    censor: "[REDACTED]",
  },
  transport:
    env.NODE_ENV === "development"
      ? { target: "pino-pretty", options: { colorize: true, translateTime: "HH:MM:ss.l" } }
      : undefined,
});

export type Logger = typeof logger;
