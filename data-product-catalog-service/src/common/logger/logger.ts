import pino from "pino";
import { env } from "../../config/env.js";

// Never logs whole contract bodies (spec §44) — call sites log
// data_product_id/version/contract_id/contract_hash/correlation_id instead.
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
