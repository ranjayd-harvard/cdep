import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(8080),

  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),

  OBJECT_STORAGE_PROVIDER: z.literal("s3").default("s3"),
  OBJECT_STORAGE_ENDPOINT: z.string().url(),
  OBJECT_STORAGE_PUBLIC_ENDPOINT: z.string().url().optional(),
  OBJECT_STORAGE_REGION: z.string().default("us-east-1"),
  OBJECT_STORAGE_ACCESS_KEY: z.string().min(1),
  OBJECT_STORAGE_SECRET_KEY: z.string().min(1),

  INBOUND_BUCKET: z.string().min(1).default("exchange-inbound"),
  OUTBOUND_BUCKET: z.string().min(1).default("exchange-outbound"),

  SIGNED_UPLOAD_URL_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  SIGNED_DOWNLOAD_URL_TTL_SECONDS: z.coerce.number().int().positive().default(300),

  MAX_UPLOAD_SIZE_BYTES: z.coerce.number().int().positive().default(5_368_709_120),

  AUTH_MODE: z.enum(["development", "oidc"]).default("development"),

  // OIDC/JWT verification (spec §5/§7). OIDC_ISSUER_URL is compared against
  // the token's `iss` claim; OIDC_JWKS_URI is where verification keys are
  // fetched from — kept separate because in Docker the two are often
  // different hostnames for the same Keycloak instance (see
  // identity-provider/docker-compose.yml). Required whenever AUTH_MODE=oidc.
  OIDC_ISSUER_URL: z.string().url().optional(),
  OIDC_JWKS_URI: z.string().url().optional(),
  OIDC_AUDIENCE: z.string().min(1).optional(),

  INTERNAL_API_KEY: z.string().min(1).default("dev-internal-key-change-me"),

  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),

  // Phase 11 (spec §31/§33) — replaces `cors: { origin: true }` (reflect
  // any origin). Comma-separated; the portal's own dev origin is the only
  // sensible local default.
  CORS_ALLOWED_ORIGINS: z.string().default("http://localhost:3091"),

  // Outbound calls this service makes to data-lakehouse and
  // data-publication-service to run the real Bronze->Silver->Gold->Publish
  // chain for queued pipeline jobs (see src/pipeline-worker/). Both
  // optional, same opt-in pattern as everywhere else in this stack: when
  // either is unset, the worker simply never starts and enqueued jobs stay
  // PENDING instead of crashing anything.
  LAKEHOUSE_SERVICE_URL: z.string().url().optional(),
  LAKEHOUSE_SERVICE_INTERNAL_API_KEY: z.string().optional(),
  PUBLICATION_SERVICE_URL: z.string().url().optional(),
  PUBLICATION_SERVICE_INTERNAL_API_KEY: z.string().optional(),
  PIPELINE_WORKER_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(15_000),
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

  if (parsed.data.NODE_ENV === "production" && parsed.data.INTERNAL_API_KEY === "dev-internal-key-change-me") {
    throw new Error("INTERNAL_API_KEY must be overridden from its default value when NODE_ENV=production");
  }

  return parsed.data;
}

export const env = loadEnv();
