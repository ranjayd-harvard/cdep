import type { Exchange } from "@/models";
import type { ExchangeService } from "@/services/interfaces";
import type { TenantContext } from "@/lib/tenant";
import { MOCK_EXCHANGES } from "@/data/mocks/exchanges";
import { simulateLatency } from "@/lib/simulate";

export class MockExchangeService implements ExchangeService {
  async getExchanges(context: TenantContext): Promise<Exchange[]> {
    await simulateLatency();
    return MOCK_EXCHANGES.filter((exchange) => exchange.tenantId === context.tenantId);
  }

  async getExchange(context: TenantContext, exchangeId: string): Promise<Exchange | null> {
    await simulateLatency();
    const exchange = MOCK_EXCHANGES.find((item) => item.id === exchangeId);
    if (!exchange || exchange.tenantId !== context.tenantId) return null;
    return exchange;
  }
}
