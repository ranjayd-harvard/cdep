import type { FastifyReply, FastifyRequest } from "fastify";
import { AppError } from "../common/errors/app-error.js";
import { env } from "../config/env.js";

// Protects internal-only endpoints (e.g. the future-Gold publication
// simulator) separately from customer-facing JWT auth — AGENTS.md section 37.
// A shared static key is sufficient for this phase; a real deployment would
// put this behind network isolation (private subnet / service mesh mTLS)
// rather than relying on the key alone.
export async function requireInternalApiKey(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  const provided = request.headers["x-internal-api-key"];
  if (!provided || provided !== env.INTERNAL_API_KEY) {
    throw new AppError("FORBIDDEN", "Missing or invalid internal API key.");
  }
}
