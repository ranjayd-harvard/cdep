import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(8092),

  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),

  AUTH_MODE: z.enum(["development", "oidc"]).default("development"),

  INTERNAL_API_TOKEN: z.string().min(1).default("dev-internal-key-change-me"),

  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),

  // Phase 11 (spec §31/§33) — replaces `cors: { origin: true }` (reflect
  // any origin). Comma-separated; the portal's own dev origin is the only
  // sensible local default.
  CORS_ALLOWED_ORIGINS: z.string().default("http://localhost:3091"),

  // Phase 10 §19: default grace period applied when a version becomes
  // DEPRECATED (either explicitly or by being superseded) without an
  // explicit gracePeriodDays override.
  DEFAULT_GRACE_PERIOD_DAYS: z.coerce.number().int().positive().default(90),

  // Phase 10 §21: retirement-guard sibling clients. Same naming convention
  // as every other service's outbound client config
  // (<SERVICE>_URL/<SERVICE>_INTERNAL_API_KEY/<SERVICE>_TIMEOUT_SECONDS).
  SUBSCRIPTION_SERVICE_URL: z.string().optional(),
  SUBSCRIPTION_SERVICE_INTERNAL_API_KEY: z.string().default("dev-internal-key-change-me"),
  SUBSCRIPTION_SERVICE_TIMEOUT_SECONDS: z.coerce.number().positive().default(5),

  SCHEDULING_SERVICE_URL: z.string().optional(),
  SCHEDULING_SERVICE_INTERNAL_API_KEY: z.string().default("dev-internal-key-change-me"),
  SCHEDULING_SERVICE_TIMEOUT_SECONDS: z.coerce.number().positive().default(5),

  PUBLICATION_SERVICE_URL: z.string().optional(),
  PUBLICATION_SERVICE_INTERNAL_API_KEY: z.string().default("dev-internal-key-change-me"),
  PUBLICATION_SERVICE_TIMEOUT_SECONDS: z.coerce.number().positive().default(5),

  IDEMPOTENCY_TTL_HOURS: z.coerce.number().positive().default(48),
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

  if (parsed.data.NODE_ENV === "production" && parsed.data.INTERNAL_API_TOKEN === "dev-internal-key-change-me") {
    throw new Error("INTERNAL_API_TOKEN must be overridden from its default value when NODE_ENV=production");
  }

  if (parsed.data.NODE_ENV === "production" && parsed.data.SUBSCRIPTION_SERVICE_INTERNAL_API_KEY === "dev-internal-key-change-me") {
    throw new Error("SUBSCRIPTION_SERVICE_INTERNAL_API_KEY must be overridden from its default value when NODE_ENV=production");
  }
  if (parsed.data.NODE_ENV === "production" && parsed.data.SCHEDULING_SERVICE_INTERNAL_API_KEY === "dev-internal-key-change-me") {
    throw new Error("SCHEDULING_SERVICE_INTERNAL_API_KEY must be overridden from its default value when NODE_ENV=production");
  }
  if (parsed.data.NODE_ENV === "production" && parsed.data.PUBLICATION_SERVICE_INTERNAL_API_KEY === "dev-internal-key-change-me") {
    throw new Error("PUBLICATION_SERVICE_INTERNAL_API_KEY must be overridden from its default value when NODE_ENV=production");
  }

  return parsed.data;
}

export const env = loadEnv();

export const subscriptionServiceEnabled = Boolean(env.SUBSCRIPTION_SERVICE_URL);
export const schedulingServiceEnabled = Boolean(env.SCHEDULING_SERVICE_URL);
export const publicationServiceEnabled = Boolean(env.PUBLICATION_SERVICE_URL);
