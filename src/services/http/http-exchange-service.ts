import type { Exchange } from "@/models";
import type { ExchangeService } from "@/services/interfaces";
import type { TenantContext } from "@/lib/tenant";
import { httpGet } from "@/lib/http-client";

/**
 * Tenant identity is never sent over the wire — derived server-side from
 * the session. No `/api/exchanges` route exists today: the Exchanges
 * pages are Server Components reading `services.exchanges` directly, and
 * nothing client-side mutates or re-fetches an Exchange, so these
 * endpoints are unexercised (kept for interface/shape parity).
 */
export class HttpExchangeService implements ExchangeService {
  getExchanges(_context: TenantContext): Promise<Exchange[]> {
    return httpGet<Exchange[]>(`/api/exchanges`);
  }

  getExchange(_context: TenantContext, exchangeId: string): Promise<Exchange | null> {
    return httpGet<Exchange | null>(`/api/exchanges/${encodeURIComponent(exchangeId)}`);
  }
}
