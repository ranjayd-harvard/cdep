import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(8095),

  AUTH_MODE: z.enum(["development", "oidc"]).default("development"),

  OIDC_ISSUER_URL: z.string().url().optional(),
  OIDC_JWKS_URI: z.string().url().optional(),
  OIDC_AUDIENCE: z.string().min(1).optional(),

  SERVING_STORE_DATABASE_URL: z.string().min(1, "SERVING_STORE_DATABASE_URL is required"),

  CATALOG_SERVICE_URL: z.string().min(1, "CATALOG_SERVICE_URL is required"),
  CATALOG_SERVICE_INTERNAL_API_KEY: z.string().default("dev-internal-key-change-me"),

  SUBSCRIPTION_SERVICE_URL: z.string().min(1, "SUBSCRIPTION_SERVICE_URL is required"),
  SUBSCRIPTION_SERVICE_INTERNAL_API_KEY: z.string().default("dev-internal-key-change-me"),

  CURSOR_SIGNING_SECRET: z.string().min(16, "CURSOR_SIGNING_SECRET must be at least 16 characters"),

  // Rate-limit hook (spec §8.11) -- a real quota backend is explicitly out
  // of scope; this in-memory limiter exists to prove the hook, defaulting
  // high enough to be a no-op for normal demo/test traffic.
  RATE_LIMIT_REQUESTS_PER_MINUTE: z.coerce.number().int().positive().default(600),

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

  if (parsed.data.NODE_ENV === "production" && parsed.data.AUTH_MODE === "development") {
    throw new Error("AUTH_MODE=development is not permitted when NODE_ENV=production");
  }

  if (
    parsed.data.AUTH_MODE === "oidc" &&
    (!parsed.data.OIDC_ISSUER_URL || !parsed.data.OIDC_JWKS_URI || !parsed.data.OIDC_AUDIENCE)
  ) {
    throw new Error("AUTH_MODE=oidc requires OIDC_ISSUER_URL, OIDC_JWKS_URI, and OIDC_AUDIENCE to be set");
  }

  if (parsed.data.NODE_ENV === "production" && parsed.data.CATALOG_SERVICE_INTERNAL_API_KEY === "dev-internal-key-change-me") {
    throw new Error("CATALOG_SERVICE_INTERNAL_API_KEY must be overridden from its default value when NODE_ENV=production");
  }
  if (parsed.data.NODE_ENV === "production" && parsed.data.SUBSCRIPTION_SERVICE_INTERNAL_API_KEY === "dev-internal-key-change-me") {
    throw new Error("SUBSCRIPTION_SERVICE_INTERNAL_API_KEY must be overridden from its default value when NODE_ENV=production");
  }

  return parsed.data;
}

export const env = loadEnv();
