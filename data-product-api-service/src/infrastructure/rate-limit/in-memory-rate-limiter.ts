import type { RateLimiter } from "../../ports/rate-limiter.port.js";

// Fixed-window in-memory limiter, one window per key (spec §8.11 dimension
// examples: tenant/organization/subscription/product/endpoint/commercial
// tier — this MVP keys on organizationId+tenantId+dataProductId+endpoint,
// see the caller). Single-process only: a real deployment with multiple
// replicas needs a shared backend (Redis, etc.) behind this same
// interface — never route-handler-visible either way.
export class InMemoryRateLimiter implements RateLimiter {
  private readonly windowMs = 60_000;
  private readonly counts = new Map<string, { windowStart: number; count: number }>();

  constructor(private readonly requestsPerWindow: number) {}

  async checkAndConsume(key: string): Promise<{ allowed: boolean }> {
    const now = Date.now();
    const existing = this.counts.get(key);
    if (!existing || now - existing.windowStart >= this.windowMs) {
      this.counts.set(key, { windowStart: now, count: 1 });
      return { allowed: true };
    }
    existing.count += 1;
    return { allowed: existing.count <= this.requestsPerWindow };
  }
}
