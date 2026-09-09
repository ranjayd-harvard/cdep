import pino from "pino";
import { env } from "../../config/env.js";

// Never logs JWTs, Authorization headers, or customer response rows (spec
// §8.13) — call sites log request_id/tenant_id/product_id/version/etc.
// instead, matching subscription-service's redaction convention.
export const logger = pino({
  level: env.LOG_LEVEL,
  redact: {
    paths: ["req.headers.authorization", "req.headers['x-internal-api-key']", "*.token", "response.data"],
    censor: "[REDACTED]",
  },
  transport:
    env.NODE_ENV === "development"
      ? { target: "pino-pretty", options: { colorize: true, translateTime: "HH:MM:ss.l" } }
      : undefined,
});

export type Logger = typeof logger;
