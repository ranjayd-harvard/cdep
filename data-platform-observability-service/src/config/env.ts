import { z } from "zod";
import { OPERATIONAL_STAGES } from "./constants.js";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(8097),

  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),

  AUTH_MODE: z.enum(["development", "oidc"]).default("development"),

  OIDC_ISSUER_URL: z.string().url().optional(),
  OIDC_JWKS_URI: z.string().url().optional(),
  OIDC_AUDIENCE: z.string().min(1).optional(),

  INTERNAL_API_TOKEN: z.string().min(1).default("dev-internal-key-change-me"),

  // Direct read-only Postgres connection to data-lakehouse — same precedent
  // data-publication-service already uses for the same database (see
  // PUBLICATION_LAKEHOUSE_METADATA_DB_URL in that service's compose file).
  // Optional so unit tests / a partial local setup can boot without it.
  LAKEHOUSE_METADATA_DATABASE_URL: z.string().optional(),

  EXCHANGE_SERVICE_URL: z.string().optional(),
  EXCHANGE_SERVICE_INTERNAL_API_KEY: z.string().default("dev-internal-key-change-me"),
  EXCHANGE_SERVICE_TIMEOUT_SECONDS: z.coerce.number().positive().default(5),

  CATALOG_SERVICE_URL: z.string().optional(),
  CATALOG_SERVICE_INTERNAL_API_KEY: z.string().default("dev-internal-key-change-me"),
  CATALOG_SERVICE_TIMEOUT_SECONDS: z.coerce.number().positive().default(5),

  SUBSCRIPTION_SERVICE_URL: z.string().optional(),
  SUBSCRIPTION_SERVICE_INTERNAL_API_KEY: z.string().default("dev-internal-key-change-me"),
  SUBSCRIPTION_SERVICE_TIMEOUT_SECONDS: z.coerce.number().positive().default(5),

  SCHEDULING_SERVICE_URL: z.string().optional(),
  SCHEDULING_SERVICE_INTERNAL_API_KEY: z.string().default("dev-internal-key-change-me"),
  SCHEDULING_SERVICE_TIMEOUT_SECONDS: z.coerce.number().positive().default(5),

  PUBLICATION_SERVICE_URL: z.string().optional(),
  PUBLICATION_SERVICE_INTERNAL_API_KEY: z.string().default("dev-internal-key-change-me-publication"),
  PUBLICATION_SERVICE_TIMEOUT_SECONDS: z.coerce.number().positive().default(30),

  SERVING_PROJECTION_SERVICE_URL: z.string().optional(),
  SERVING_PROJECTION_SERVICE_INTERNAL_API_KEY: z.string().default("dev-internal-key-change-me"),
  SERVING_PROJECTION_SERVICE_TIMEOUT_SECONDS: z.coerce.number().positive().default(5),

  // Poll/reconcile cadence (spec section 8). No correctness property
  // depends on exact alignment between ticks — the join-key index +
  // dedup-by-event_id make polling idempotent regardless of cadence.
  POLL_ENABLED: z.coerce.boolean().default(true),
  POLL_INTERVAL_SECONDS_EXCHANGE: z.coerce.number().positive().default(15),
  POLL_INTERVAL_SECONDS_CATALOG: z.coerce.number().positive().default(60),
  POLL_INTERVAL_SECONDS_SUBSCRIPTION: z.coerce.number().positive().default(30),
  POLL_INTERVAL_SECONDS_SCHEDULING: z.coerce.number().positive().default(15),
  POLL_INTERVAL_SECONDS_PUBLICATION: z.coerce.number().positive().default(15),
  POLL_INTERVAL_SECONDS_LAKEHOUSE: z.coerce.number().positive().default(15),
  POLL_INTERVAL_SECONDS_SERVING_PROJECTION: z.coerce.number().positive().default(30),
  RECONCILE_INTERVAL_SECONDS: z.coerce.number().positive().default(120),

  // Correlation (spec section 5) — how far back the heuristic
  // (org, tenant, product, version) fallback looks for an already-open
  // execution when no explicit ID chain is available yet.
  CORRELATION_WINDOW_MINUTES: z.coerce.number().positive().default(120),

  // Stuck-run detection (spec section 19) — per-stage default; can be
  // overridden per product/version at evaluation time via sla_definitions
  // STAGE_TARGET rows, this is only the platform-wide fallback.
  STUCK_RUN_THRESHOLD_MINUTES_DEFAULT: z.coerce.number().positive().default(30),

  // Phase-9-owned technical stage targets (spec section 6/10) — catalog
  // declares nothing per-stage, so these seed the STAGE_TARGET sla_definitions
  // rows read by domain/sla/sla-evaluator.ts. One env var per normalized
  // stage, minutes.
  SLA_STAGE_TARGET_MINUTES_EXCHANGE_RECEIVED: z.coerce.number().positive().default(5),
  SLA_STAGE_TARGET_MINUTES_EXCHANGE_VALIDATION: z.coerce.number().positive().default(5),
  SLA_STAGE_TARGET_MINUTES_BRONZE_INGESTION: z.coerce.number().positive().default(10),
  SLA_STAGE_TARGET_MINUTES_SILVER_TRANSFORMATION: z.coerce.number().positive().default(15),
  SLA_STAGE_TARGET_MINUTES_GOLD_PRODUCT_BUILD: z.coerce.number().positive().default(15),
  SLA_STAGE_TARGET_MINUTES_QUALITY_VALIDATION: z.coerce.number().positive().default(5),
  SLA_STAGE_TARGET_MINUTES_PUBLICATION: z.coerce.number().positive().default(15),
  SLA_STAGE_TARGET_MINUTES_OUTBOUND_EXCHANGE: z.coerce.number().positive().default(5),
  SLA_STAGE_TARGET_MINUTES_FILE_DELIVERY: z.coerce.number().positive().default(5),
  SLA_STAGE_TARGET_MINUTES_API_DELIVERY: z.coerce.number().positive().default(5),

  // Health score weights (spec section 17) — must sum to 1.0, validated at
  // boot below so a misconfigured weight set fails loudly rather than
  // silently producing a meaningless score.
  HEALTH_WEIGHT_SLA: z.coerce.number().min(0).max(1).default(0.3),
  HEALTH_WEIGHT_FRESHNESS: z.coerce.number().min(0).max(1).default(0.2),
  HEALTH_WEIGHT_QUALITY: z.coerce.number().min(0).max(1).default(0.2),
  HEALTH_WEIGHT_AVAILABILITY: z.coerce.number().min(0).max(1).default(0.15),
  HEALTH_WEIGHT_PUBLICATION_SUCCESS: z.coerce.number().min(0).max(1).default(0.1),
  HEALTH_WEIGHT_RETRY_FAILURE: z.coerce.number().min(0).max(1).default(0.05),

  // Alerting (spec sections 21-24).
  ALERT_SUPPRESSION_WINDOW_MINUTES: z.coerce.number().positive().default(60),
  INCIDENT_CORRELATION_WINDOW_MINUTES: z.coerce.number().positive().default(30),
  NO_DATA_WINDOW_MINUTES_DEFAULT: z.coerce.number().positive().default(1440),

  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),

  // Phase 11 (spec §31/§33) — replaces `cors: { origin: true }` (reflect
  // any origin). Comma-separated; the portal's own dev origin is the only
  // sensible local default.
  CORS_ALLOWED_ORIGINS: z.string().default("http://localhost:3091"),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    // eslint-disable-next-line no-console
    console.error("Invalid environment configuration:", parsed.error.flatten().fieldErrors);
    throw new Error("Invalid environment configuration");
  }

  const data = parsed.data;

  if (data.NODE_ENV === "production" && data.AUTH_MODE === "development") {
    throw new Error("AUTH_MODE=development is not permitted when NODE_ENV=production");
  }

  if (data.AUTH_MODE === "oidc" && (!data.OIDC_ISSUER_URL || !data.OIDC_JWKS_URI || !data.OIDC_AUDIENCE)) {
    throw new Error("AUTH_MODE=oidc requires OIDC_ISSUER_URL, OIDC_JWKS_URI, and OIDC_AUDIENCE to be set");
  }

  if (data.NODE_ENV === "production" && data.INTERNAL_API_TOKEN === "dev-internal-key-change-me") {
    throw new Error("INTERNAL_API_TOKEN must be overridden from its default value when NODE_ENV=production");
  }

  const weightSum =
    data.HEALTH_WEIGHT_SLA +
    data.HEALTH_WEIGHT_FRESHNESS +
    data.HEALTH_WEIGHT_QUALITY +
    data.HEALTH_WEIGHT_AVAILABILITY +
    data.HEALTH_WEIGHT_PUBLICATION_SUCCESS +
    data.HEALTH_WEIGHT_RETRY_FAILURE;
  // Floating point tolerance, not exact equality — weights are typically
  // hand-edited decimals in .env.
  if (Math.abs(weightSum - 1) > 0.001) {
    throw new Error(`Health score weights must sum to 1.0 (got ${weightSum.toFixed(4)}). Fix HEALTH_WEIGHT_* env vars.`);
  }

  if (data.NODE_ENV === "production" && data.EXCHANGE_SERVICE_INTERNAL_API_KEY === "dev-internal-key-change-me") {
    throw new Error("EXCHANGE_SERVICE_INTERNAL_API_KEY must be overridden from its default value when NODE_ENV=production");
  }
  if (data.NODE_ENV === "production" && data.CATALOG_SERVICE_INTERNAL_API_KEY === "dev-internal-key-change-me") {
    throw new Error("CATALOG_SERVICE_INTERNAL_API_KEY must be overridden from its default value when NODE_ENV=production");
  }
  if (data.NODE_ENV === "production" && data.SUBSCRIPTION_SERVICE_INTERNAL_API_KEY === "dev-internal-key-change-me") {
    throw new Error("SUBSCRIPTION_SERVICE_INTERNAL_API_KEY must be overridden from its default value when NODE_ENV=production");
  }
  if (data.NODE_ENV === "production" && data.SCHEDULING_SERVICE_INTERNAL_API_KEY === "dev-internal-key-change-me") {
    throw new Error("SCHEDULING_SERVICE_INTERNAL_API_KEY must be overridden from its default value when NODE_ENV=production");
  }
  if (data.NODE_ENV === "production" && data.PUBLICATION_SERVICE_INTERNAL_API_KEY === "dev-internal-key-change-me-publication") {
    throw new Error("PUBLICATION_SERVICE_INTERNAL_API_KEY must be overridden from its default value when NODE_ENV=production");
  }
  if (data.NODE_ENV === "production" && data.SERVING_PROJECTION_SERVICE_INTERNAL_API_KEY === "dev-internal-key-change-me") {
    throw new Error("SERVING_PROJECTION_SERVICE_INTERNAL_API_KEY must be overridden from its default value when NODE_ENV=production");
  }

  return data;
}

export const env = loadEnv();

// Feature-gated the same way scheduling-service treats *_SERVICE_URL — a
// missing URL means "not configured, poller disabled", never "guess and
// allow" (spec section 9: adapters must never fabricate sibling state).
export const exchangeServiceEnabled = Boolean(env.EXCHANGE_SERVICE_URL);
export const catalogServiceEnabled = Boolean(env.CATALOG_SERVICE_URL);
export const subscriptionServiceEnabled = Boolean(env.SUBSCRIPTION_SERVICE_URL);
export const schedulingServiceEnabled = Boolean(env.SCHEDULING_SERVICE_URL);
export const publicationServiceEnabled = Boolean(env.PUBLICATION_SERVICE_URL);
export const servingProjectionServiceEnabled = Boolean(env.SERVING_PROJECTION_SERVICE_URL);
export const lakehouseMetadataEnabled = Boolean(env.LAKEHOUSE_METADATA_DATABASE_URL);

export const healthWeights = {
  sla: env.HEALTH_WEIGHT_SLA,
  freshness: env.HEALTH_WEIGHT_FRESHNESS,
  quality: env.HEALTH_WEIGHT_QUALITY,
  availability: env.HEALTH_WEIGHT_AVAILABILITY,
  publicationSuccess: env.HEALTH_WEIGHT_PUBLICATION_SUCCESS,
  retryFailure: env.HEALTH_WEIGHT_RETRY_FAILURE,
};

const STAGE_TARGET_ENV_KEY: Record<(typeof OPERATIONAL_STAGES)[number], keyof Env> = {
  EXCHANGE_RECEIVED: "SLA_STAGE_TARGET_MINUTES_EXCHANGE_RECEIVED",
  EXCHANGE_VALIDATION: "SLA_STAGE_TARGET_MINUTES_EXCHANGE_VALIDATION",
  BRONZE_INGESTION: "SLA_STAGE_TARGET_MINUTES_BRONZE_INGESTION",
  SILVER_TRANSFORMATION: "SLA_STAGE_TARGET_MINUTES_SILVER_TRANSFORMATION",
  GOLD_PRODUCT_BUILD: "SLA_STAGE_TARGET_MINUTES_GOLD_PRODUCT_BUILD",
  QUALITY_VALIDATION: "SLA_STAGE_TARGET_MINUTES_QUALITY_VALIDATION",
  PUBLICATION: "SLA_STAGE_TARGET_MINUTES_PUBLICATION",
  OUTBOUND_EXCHANGE: "SLA_STAGE_TARGET_MINUTES_OUTBOUND_EXCHANGE",
  FILE_DELIVERY: "SLA_STAGE_TARGET_MINUTES_FILE_DELIVERY",
  API_DELIVERY: "SLA_STAGE_TARGET_MINUTES_API_DELIVERY",
};

export function defaultStageTargetMinutes(stage: (typeof OPERATIONAL_STAGES)[number]): number {
  return env[STAGE_TARGET_ENV_KEY[stage]] as number;
}
