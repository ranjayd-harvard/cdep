// Shared across every outbound HTTP adapter (exchange/catalog/subscription/
// scheduling/publication/serving-projection). `retriable` is informational
// here (unlike scheduling-service, this service never retries a sibling's
// workflow on this signal) — it only affects whether a poller/reconciler
// logs at warn vs. error and whether it counts toward service_health.
export type DependencyService =
  | "EXCHANGE"
  | "CATALOG"
  | "SUBSCRIPTION"
  | "SCHEDULING"
  | "PUBLICATION"
  | "LAKEHOUSE"
  | "SERVING_PROJECTION";

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
