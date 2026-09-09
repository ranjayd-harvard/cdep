import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

// Minimal .env loader for the test process — same convention as
// subscription-service's own tests/setup/load-env.ts.
const envPath = path.resolve(process.cwd(), ".env");

if (existsSync(envPath)) {
  const content = readFileSync(envPath, "utf8");
  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

if (!process.env.SERVING_STORE_DATABASE_URL) {
  process.env.SERVING_STORE_DATABASE_URL = "postgresql://serving:serving@localhost:5440/serving";
}
if (!process.env.CATALOG_SERVICE_URL) {
  process.env.CATALOG_SERVICE_URL = "http://localhost:8092";
}
if (!process.env.SUBSCRIPTION_SERVICE_URL) {
  process.env.SUBSCRIPTION_SERVICE_URL = "http://localhost:8093";
}
if (!process.env.CURSOR_SIGNING_SECRET) {
  process.env.CURSOR_SIGNING_SECRET = "test-cursor-signing-secret-not-for-prod";
}
if (!process.env.LOG_LEVEL) {
  process.env.LOG_LEVEL = "silent";
}
