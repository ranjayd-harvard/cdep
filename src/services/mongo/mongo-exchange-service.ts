import type { Exchange } from "@/models";
import type { ExchangeService } from "@/services/interfaces";
import type { TenantContext } from "@/lib/tenant";
import { listExchanges, getExchangeById } from "@/lib/exchange-directory";

export class MongoExchangeService implements ExchangeService {
  getExchanges(context: TenantContext): Promise<Exchange[]> {
    return listExchanges(context.tenantId);
  }

  getExchange(context: TenantContext, exchangeId: string): Promise<Exchange | null> {
    return getExchangeById(context.tenantId, exchangeId);
  }
}
