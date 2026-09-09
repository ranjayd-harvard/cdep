import type { FastifyInstance } from "fastify";
import { buildApp } from "../../app.js";

export async function createTestApp(): Promise<FastifyInstance> {
  const app = await buildApp();
  await app.ready();
  return app;
}

// AUTH_MODE=development lets requests with no x-internal-api-key through as
// a fixed PLATFORM_ADMIN dev identity (see auth.middleware.ts), so
// integration tests don't need to pass headers for the common case. This
// helper exists for the tests that specifically exercise role/header
// handling.
export function internalHeaders(overrides: Partial<Record<string, string>> = {}) {
  return {
    "x-internal-api-key": process.env.INTERNAL_API_TOKEN ?? "dev-internal-key-change-me",
    "x-actor-type": "CI",
    "x-actor-id": "test-suite",
    "x-actor-role": "PLATFORM_ADMIN",
    ...overrides,
  };
}
