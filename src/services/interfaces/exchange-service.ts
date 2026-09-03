import type { Exchange } from "@/models";

export interface ExchangeService {
  getExchanges(tenantId: string): Promise<Exchange[]>;
  getExchange(tenantId: string, exchangeId: string): Promise<Exchange | null>;
}
