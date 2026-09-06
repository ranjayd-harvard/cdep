import { logger } from "../common/logger/logger.js";
import { appendExchangeEvent } from "./exchange-event.service.js";

export interface ExchangeReadyPayload {
  exchangeId: string;
  organizationId: string;
  tenantId: string;
  dataProductId: string;
}

// Future Bronze handoff boundary — see AGENTS.md section 56/57. The Exchange
// Service does not know Bronze table names or ingestion mechanics; it only
// announces "this inbound exchange is VALIDATED and ready". Future adapters
// (Kafka, Pub/Sub, EventBridge, Azure Service Bus, a workflow orchestrator)
// implement this same interface.
export interface IngestionNotifier {
  notifyExchangeReady(exchange: ExchangeReadyPayload): Promise<void>;
}

export class LoggingIngestionNotifier implements IngestionNotifier {
  async notifyExchangeReady(exchange: ExchangeReadyPayload): Promise<void> {
    logger.info({ exchange }, "EXCHANGE_READY_FOR_INGESTION");
    await appendExchangeEvent({
      exchangeId: exchange.exchangeId,
      eventType: "EXCHANGE_READY_FOR_INGESTION",
      actorType: "SYSTEM",
      eventData: { dataProductId: exchange.dataProductId },
    });
  }
}

export const ingestionNotifier: IngestionNotifier = new LoggingIngestionNotifier();
