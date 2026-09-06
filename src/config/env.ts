/**
 * Central runtime configuration.
 *
 * `useMockServices` is the single switch that decides whether the
 * *client-side* service factory (`src/services/client.ts`) wires up mock
 * implementations or the `Http*Service` ones that call this app's own
 * `/api/*` route handlers. See `docs/exchange-service-integration.md` for
 * the full picture — that same doc covers `exchangeServiceUrl` below,
 * which is a separate, server-only switch.
 */
export const env = {
  useMockServices: process.env.NEXT_PUBLIC_USE_MOCK_SERVICES !== "false",
  // Empty string = same-origin relative requests, i.e. this app's own
  // `/api/*` route handlers (see `src/app/api/`). Must stay empty/unset:
  // the `Http*Service` implementations are browser code, and the only
  // backend they may ever call directly is this app's own API — never
  // data-exchange-service directly (see `exchangeServiceUrl` below for
  // why). Do not point this at data-exchange-service's URL.
  apiBaseUrl: process.env.NEXT_PUBLIC_API_BASE_URL ?? "",
  appName: process.env.NEXT_PUBLIC_APP_NAME ?? "Data Exchange",
  mongoUri: process.env.MONGODB_URI ?? "mongodb://localhost:27025/portal",
  mongoDatabase: process.env.MONGO_DATABASE ?? "portal",
  // Server-only (no NEXT_PUBLIC_ prefix — never sent to the browser).
  // Base URL of the data-exchange-service control plane, e.g.
  // "http://localhost:8080" outside Docker or "http://host.docker.internal:8080"
  // when the portal itself runs inside cdep's own docker-compose. When
  // unset, `src/services/index.ts` falls back to the Mongo-backed
  // Exchange/Upload/Download services — this is what makes the
  // integration opt-in and non-breaking for anyone who doesn't have
  // data-exchange-service running. See `docs/exchange-service-integration.md`.
  exchangeServiceUrl: process.env.EXCHANGE_SERVICE_URL ?? "",
  exchangeServiceEnabled: Boolean(process.env.EXCHANGE_SERVICE_URL),
  // Only needed for the (currently opt-in) publish-on-upload behavior in
  // `ExchangeApiUploadService` — see that file. Never sent to the browser.
  exchangeServiceInternalApiKey: process.env.EXCHANGE_SERVICE_INTERNAL_API_KEY ?? "",
  // Only needed when THIS app also runs inside Docker (see
  // docker-compose.yml) — see the doc comment on `putToSignedUrl` in
  // `src/lib/exchange-service/client.ts` and
  // docs/exchange-service-integration.md § "Docker-in-Docker: the storage
  // relay host problem". Typically "host.docker.internal:9000".
  exchangeServiceStorageRelayHost: process.env.EXCHANGE_SERVICE_STORAGE_RELAY_HOST ?? "",
  // Server-only. Base URL of data-lakehouse's own internal HTTP API (its
  // src/lakehouse/api/), e.g. "http://localhost:8090" outside Docker. Backs
  // the superadmin-only /admin/lakehouse page. When unset (or when
  // EXCHANGE_SERVICE_URL is unset), that page renders a "not configured"
  // empty state instead of crashing — same opt-in, non-breaking pattern as
  // exchangeServiceUrl above.
  lakehouseServiceUrl: process.env.LAKEHOUSE_SERVICE_URL ?? "",
  lakehouseServiceEnabled: Boolean(process.env.LAKEHOUSE_SERVICE_URL),
  // Sent as `x-internal-api-key` to data-lakehouse's /internal/v1/* routes —
  // a separate key/service from exchangeServiceInternalApiKey above. Never
  // sent to the browser.
  lakehouseServiceInternalApiKey: process.env.LAKEHOUSE_SERVICE_INTERNAL_API_KEY ?? "",
  // Server-only. Base URL of data-publication-service's own internal HTTP
  // API (its src/publication/api/), e.g. "http://localhost:8091" outside
  // Docker. Backs the "Publish Gold Product" panel on the superadmin-only
  // /admin/lakehouse/pipelines page. Same opt-in, non-breaking pattern as
  // lakehouseServiceUrl above — when unset, that panel renders a "not
  // configured" empty state instead of crashing.
  publicationServiceUrl: process.env.PUBLICATION_SERVICE_URL ?? "",
  publicationServiceEnabled: Boolean(process.env.PUBLICATION_SERVICE_URL),
  // Sent as `x-internal-api-key` to data-publication-service's
  // /internal/v1/* routes — a separate key/service from
  // lakehouseServiceInternalApiKey above. Never sent to the browser.
  publicationServiceInternalApiKey: process.env.PUBLICATION_SERVICE_INTERNAL_API_KEY ?? "",
} as const;
