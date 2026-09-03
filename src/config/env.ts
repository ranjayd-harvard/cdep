/**
 * Central runtime configuration.
 *
 * `useMockServices` is the single switch that decides whether the service
 * factory in `src/services/index.ts` wires up mock implementations or the
 * future HTTP implementations. Flipping NEXT_PUBLIC_USE_MOCK_SERVICES to
 * "false" (once real middle-tier APIs exist) is the only change required —
 * no UI or component code depends on this flag directly.
 */
export const env = {
  useMockServices: process.env.NEXT_PUBLIC_USE_MOCK_SERVICES !== "false",
  // Empty string = same-origin relative requests, i.e. this app's own
  // `/api/*` route handlers (see `src/app/api/`). No separate middle-tier
  // service exists anywhere in this repo's deployment (`docker-compose.yml`
  // only defines `portal` + `mongo`) — set this only if/when one does.
  apiBaseUrl: process.env.NEXT_PUBLIC_API_BASE_URL ?? "",
  appName: process.env.NEXT_PUBLIC_APP_NAME ?? "Data Exchange",
  mongoUri: process.env.MONGODB_URI ?? "mongodb://localhost:27025/portal",
  mongoDatabase: process.env.MONGO_DATABASE ?? "portal",
} as const;
