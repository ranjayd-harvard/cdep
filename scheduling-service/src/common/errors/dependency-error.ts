// Shared across every outbound HTTP client (Catalog/Subscription/
// Entitlement/Publication). `retriable` is what RetryCoordinator's failure
// classification (AGENTS.md section 63-64) keys off of: network failures,
// timeouts, and 5xx responses are retriable; 4xx validation/not-found
// responses generally are not (the caller decides which 4xx cases instead
// return a structured "not found"/"ineligible" result rather than
// throwing at all — see e.g. CatalogHttpClient.getProduct returning null).
export type DependencyService = "CATALOG" | "SUBSCRIPTION" | "ENTITLEMENT" | "PUBLICATION";

export class DependencyError extends Error {
  readonly service: DependencyService;
  readonly retriable: boolean;

  constructor(message: string, service: DependencyService, retriable: boolean) {
    super(message);
    this.name = "DependencyError";
    this.service = service;
    this.retriable = retriable;
  }
}
