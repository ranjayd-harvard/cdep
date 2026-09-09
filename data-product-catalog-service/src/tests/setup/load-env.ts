import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

// Minimal .env loader for the test process (avoids adding a `dotenv`
// dependency for this one use). Only applied to keys not already present
// in the environment, so CI-provided env vars always win.
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
