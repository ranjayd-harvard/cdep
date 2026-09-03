import type { Exchange } from "@/models";
import type { ExchangeService } from "@/services/interfaces";
import { listExchanges, getExchangeById } from "@/lib/exchange-directory";

export class MongoExchangeService implements ExchangeService {
  getExchanges(tenantId: string): Promise<Exchange[]> {
    return listExchanges(tenantId);
  }

  getExchange(tenantId: string, exchangeId: string): Promise<Exchange | null> {
    return getExchangeById(tenantId, exchangeId);
  }
}
