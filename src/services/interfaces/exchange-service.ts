import type { Exchange } from "@/models";
import type { TenantContext } from "@/lib/tenant";

/**
 * Takes the full `TenantContext` (not just `tenantId`) because the
 * exchange-service-backed implementation (`ExchangeApiExchangeService`)
 * needs `organizationId`/`role` too, to mint the request it sends to
 * data-exchange-service — see `docs/exchange-service-integration.md`.
 * `MongoExchangeService`/`MockExchangeService` only read `.tenantId` off
 * it, same as before.
 */
export interface ExchangeService {
  getExchanges(context: TenantContext): Promise<Exchange[]>;
  getExchange(context: TenantContext, exchangeId: string): Promise<Exchange | null>;
}
