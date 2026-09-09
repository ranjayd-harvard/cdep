// Shared across every outbound HTTP client (Catalog/Subscription). Mapped
// to AppError("SERVICE_UNAVAILABLE") by app.ts's global error handler —
// network failures, timeouts, and 5xx responses land here; 4xx
// validation/not-found responses instead return a structured null/absent
// result from the client (see CatalogHttpClient.getApiContract returning
// null on 404) rather than throwing at all.
export type DependencyService = "CATALOG" | "SUBSCRIPTION";

export class DependencyError extends Error {
  readonly service: DependencyService;

  constructor(message: string, service: DependencyService) {
    super(message);
    this.name = "DependencyError";
    this.service = service;
  }
}
