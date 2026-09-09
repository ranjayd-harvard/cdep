import pino from "pino";
import { env } from "../../config/env.js";

// Never logs full request/response payloads — call sites log
// organization_id/tenant_id/subscription_id/entitlement_id/data_product_id/
// correlation_id instead (spec §49).
export const logger = pino({
  level: env.LOG_LEVEL,
  redact: {
    paths: ["req.headers.authorization", "req.headers['x-internal-api-key']", "*.token"],
    censor: "[REDACTED]",
  },
  transport:
    env.NODE_ENV === "development"
      ? { target: "pino-pretty", options: { colorize: true, translateTime: "HH:MM:ss.l" } }
      : undefined,
});

export type Logger = typeof logger;
