import type { Exchange } from "@/models";
import type { ExchangeService } from "@/services/interfaces";
import { MOCK_EXCHANGES } from "@/data/mocks/exchanges";
import { simulateLatency } from "@/lib/simulate";

export class MockExchangeService implements ExchangeService {
  async getExchanges(tenantId: string): Promise<Exchange[]> {
    await simulateLatency();
    return MOCK_EXCHANGES.filter((exchange) => exchange.tenantId === tenantId);
  }

  async getExchange(tenantId: string, exchangeId: string): Promise<Exchange | null> {
    await simulateLatency();
    const exchange = MOCK_EXCHANGES.find((item) => item.id === exchangeId);
    if (!exchange || exchange.tenantId !== tenantId) return null;
    return exchange;
  }
}
