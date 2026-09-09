// Rate-limit/quota hook (spec §8.11). A real quota backend keyed on
// tenant/organization/subscription/product/endpoint/commercial-tier and
// billing integration are both explicitly out of scope — this interface
// exists so that backend can be dropped in later (e.g. Redis-backed,
// shared across replicas) without touching route handlers.
export interface RateLimiter {
  checkAndConsume(key: string): Promise<{ allowed: boolean }>;
}
