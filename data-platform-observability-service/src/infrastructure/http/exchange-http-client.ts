import { DependencyError } from "../../common/errors/dependency-error.js";
import { env, exchangeServiceEnabled } from "../../config/env.js";
import type { ExchangeClient, ExchangeRecord } from "../../ports/exchange-client.port.js";

interface ExchangeWire {
  exchangeId: string;
  organizationId: string;
  tenantId: string;
  direction: "INBOUND" | "OUTBOUND";
  status: string;
  dataProductId: string;
  recordCount: number | null;
  errorCount: number | null;
  startedAt: string | null;
  receivedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

export class ExchangeHttpClient implements ExchangeClient {
  async listRecent(params: { direction?: "INBOUND" | "OUTBOUND"; limit: number }): Promise<ExchangeRecord[]> {
    if (!exchangeServiceEnabled) return [];

    const query = new URLSearchParams({ limit: String(params.limit) });
    if (params.direction) query.set("direction", params.direction);

    let response: Response;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), env.EXCHANGE_SERVICE_TIMEOUT_SECONDS * 1000);
      try {
        response = await fetch(`${env.EXCHANGE_SERVICE_URL}/internal/v1/exchanges?${query.toString()}`, {
          headers: { Accept: "application/json", "x-internal-api-key": env.EXCHANGE_SERVICE_INTERNAL_API_KEY },
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }
    } catch (err) {
      throw new DependencyError(`Exchange Service request failed: ${(err as Error).message}`, "EXCHANGE", true);
    }

    if (!response.ok) {
      throw new DependencyError(`Exchange Service returned ${response.status}.`, "EXCHANGE", response.status >= 500);
    }

    const body = (await response.json()) as { items: ExchangeWire[] };
    return body.items.map((item) => ({
      exchangeId: item.exchangeId,
      organizationId: item.organizationId,
      tenantId: item.tenantId,
      direction: item.direction,
      status: item.status,
      dataProductId: item.dataProductId,
      recordCount: item.recordCount,
      errorCount: item.errorCount,
      startedAt: item.startedAt ? new Date(item.startedAt) : null,
      receivedAt: item.receivedAt ? new Date(item.receivedAt) : null,
      completedAt: item.completedAt ? new Date(item.completedAt) : null,
      createdAt: new Date(item.createdAt),
    }));
  }
}
