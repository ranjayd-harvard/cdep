import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(8094),

  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),

  AUTH_MODE: z.enum(["development", "oidc"]).default("development"),

  INTERNAL_API_TOKEN: z.string().min(1).default("dev-internal-key-change-me"),

  CATALOG_SERVICE_URL: z.string().optional(),
  CATALOG_SERVICE_INTERNAL_API_KEY: z.string().default("dev-internal-key-change-me"),
  CATALOG_SERVICE_TIMEOUT_SECONDS: z.coerce.number().positive().default(5),

  SUBSCRIPTION_SERVICE_URL: z.string().optional(),
  SUBSCRIPTION_SERVICE_INTERNAL_API_KEY: z.string().default("dev-internal-key-change-me"),
  SUBSCRIPTION_SERVICE_TIMEOUT_SECONDS: z.coerce.number().positive().default(5),

  PUBLICATION_SERVICE_URL: z.string().optional(),
  PUBLICATION_SERVICE_INTERNAL_API_KEY: z.string().default("dev-internal-key-change-me"),
  PUBLICATION_SERVICE_TIMEOUT_SECONDS: z.coerce.number().positive().default(120),

  // Scheduler loop cadence (AGENTS.md section 13/67). No publication should
  // depend on exact polling alignment, so these stay configurable rather
  // than hard-coded.
  SCHEDULER_ENABLED: z.coerce.boolean().default(true),
  SCHEDULER_SCAN_INTERVAL_SECONDS: z.coerce.number().positive().default(20),
  SCHEDULER_RECONCILE_INTERVAL_SECONDS: z.coerce.number().positive().default(60),

  // Retry/backoff (section 39).
  SCHEDULER_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  SCHEDULER_INITIAL_BACKOFF_SECONDS: z.coerce.number().positive().default(30),
  SCHEDULER_MAX_BACKOFF_SECONDS: z.coerce.number().positive().default(900),
  SCHEDULER_BACKOFF_MULTIPLIER: z.coerce.number().min(1).default(2),
  SCHEDULER_BACKOFF_JITTER_RATIO: z.coerce.number().min(0).max(1).default(0.2),

  // Missed-run policy (section 36-37).
  SCHEDULER_MISSED_RUN_POLICY: z.enum(["RUN_LATEST", "SKIP", "RUN_ALL"]).default("RUN_LATEST"),
  SCHEDULER_MISSED_RUN_GRACE_MINUTES: z.coerce.number().positive().default(360),

  // Cron safety floor (section 21) — the minute-granularity 5-field cron
  // format already can't express sub-minute schedules; this bounds how
  // close together two cron-produced occurrences may legally be.
  SCHEDULER_CRON_MIN_INTERVAL_SECONDS: z.coerce.number().int().positive().default(60),

  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    // eslint-disable-next-line no-console
    console.error("Invalid environment configuration:", parsed.error.flatten().fieldErrors);
    throw new Error("Invalid environment configuration");
  }

  if (parsed.data.NODE_ENV === "production" && parsed.data.AUTH_MODE === "development") {
    throw new Error("AUTH_MODE=development is not permitted when NODE_ENV=production");
  }

  return parsed.data;
}

export const env = loadEnv();

// Feature-gated the same way subscription-service treats CATALOG_SERVICE_URL
// — a missing URL means "not configured", never "guess and allow".
export const catalogServiceEnabled = Boolean(env.CATALOG_SERVICE_URL);
export const subscriptionServiceEnabled = Boolean(env.SUBSCRIPTION_SERVICE_URL);
export const publicationServiceEnabled = Boolean(env.PUBLICATION_SERVICE_URL);
