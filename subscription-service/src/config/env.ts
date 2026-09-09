import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(8093),

  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),

  AUTH_MODE: z.enum(["development", "oidc"]).default("development"),

  INTERNAL_API_TOKEN: z.string().min(1).default("dev-internal-key-change-me"),

  CATALOG_SERVICE_URL: z.string().optional(),
  CATALOG_SERVICE_INTERNAL_API_KEY: z.string().default("dev-internal-key-change-me"),
  CATALOG_SERVICE_TIMEOUT_SECONDS: z.coerce.number().positive().default(5),

  IDEMPOTENCY_TTL_HOURS: z.coerce.number().positive().default(24),

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

// Feature-gated the same way the portal treats CATALOG_SERVICE_URL — a
// missing URL means "not configured", never "guess and allow" (spec §30).
export const catalogServiceEnabled = Boolean(env.CATALOG_SERVICE_URL);
