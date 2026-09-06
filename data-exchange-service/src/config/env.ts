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

  INTERNAL_API_KEY: z.string().min(1).default("dev-internal-key-change-me"),

  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
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
