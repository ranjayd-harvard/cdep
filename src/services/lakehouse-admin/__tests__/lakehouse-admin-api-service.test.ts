import { describe, expect, it, vi, beforeEach } from "vitest";

const {
  listExchangesInternalMock,
  listIngestionRunsByExchangeMock,
  triggerIngestionMock,
  FakeLakehouseServiceError,
} = vi.hoisted(() => {
  class FakeLakehouseServiceError extends Error {
    readonly status: number;
    readonly code: string | undefined;
    constructor(status: number, code: string | undefined, message: string) {
      super(message);
      this.status = status;
      this.code = code;
    }
  }

  return {
    listExchangesInternalMock: vi.fn(),
    listIngestionRunsByExchangeMock: vi.fn(),
    triggerIngestionMock: vi.fn(),
    FakeLakehouseServiceError,
  };
});

vi.mock("@/lib/exchange-service/client", () => ({
  listExchangesInternal: listExchangesInternalMock,
}));

vi.mock("@/lib/lakehouse-service/client", () => ({
  listIngestionRunsByExchange: listIngestionRunsByExchangeMock,
  triggerIngestion: triggerIngestionMock,
  LakehouseServiceError: FakeLakehouseServiceError,
}));

import { LakehouseAdminApiService } from "@/services/lakehouse-admin/lakehouse-admin-api-service";

const EXCHANGE = {
  exchangeId: "exc-1",
  organizationId: "org-1",
  tenantId: "tenant-1",
  direction: "INBOUND" as const,
  status: "VALIDATED",
  dataProductId: "dp-1",
  schemaVersion: "1.0",
  filename: "events.csv",
  recordCount: null,
  errorCount: null,
  startedAt: null,
  receivedAt: null,
  completedAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
};

describe("LakehouseAdminApiService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("listRecentExchangesWithIngestionStatus", () => {
    it("joins an exchange with its latest ingestion run", async () => {
      listExchangesInternalMock.mockResolvedValue({ items: [EXCHANGE] });
      listIngestionRunsByExchangeMock.mockResolvedValue([
        {
          ingestion_id: "ing-old",
          status: "FAILED",
          bronze_table: "bronze.dp_1",
          source_record_count: 5,
          bronze_record_count: 0,
          rejected_record_count: 5,
          error_code: "BRONZE_WRITE_FAILED",
          error_message: "boom",
          completed_at: "2026-01-01T00:01:00.000Z",
        },
        {
          ingestion_id: "ing-latest",
          status: "COMPLETED",
          bronze_table: "bronze.dp_1",
          source_record_count: 5,
          bronze_record_count: 5,
          rejected_record_count: 0,
          error_code: null,
          error_message: null,
          completed_at: "2026-01-01T00:02:00.000Z",
        },
      ]);

      const service = new LakehouseAdminApiService();
      const { available, items } = await service.listRecentExchangesWithIngestionStatus();

      expect(available).toBe(true);
      expect(items).toHaveLength(1);
      // list_by_exchange orders ASC by created_at -- the join takes the
      // LAST element, not the first, as "latest".
      expect(items[0]?.ingestion?.ingestionId).toBe("ing-latest");
      expect(items[0]?.ingestion?.status).toBe("COMPLETED");
      expect(items[0]?.exchangeId).toBe("exc-1");
      expect(items[0]?.organizationId).toBe("org-1");
      expect(items[0]?.filename).toBe("events.csv");
    });

    it("reports a never-ingested exchange as ingestion: null", async () => {
      listExchangesInternalMock.mockResolvedValue({ items: [EXCHANGE] });
      listIngestionRunsByExchangeMock.mockResolvedValue([]);

      const service = new LakehouseAdminApiService();
      const { items } = await service.listRecentExchangesWithIngestionStatus();

      expect(items[0]?.ingestion).toBeNull();
    });
  });

  describe("triggerIngestion", () => {
    it("returns a non-throwing result for a 404 (exchange not found)", async () => {
      triggerIngestionMock.mockRejectedValue(
        new FakeLakehouseServiceError(404, "EXCHANGE_NOT_FOUND", "not found"),
      );

      const service = new LakehouseAdminApiService();
      const result = await service.triggerIngestion("exc-missing");

      expect(result).toEqual({
        ok: false,
        status: "FAILED",
        errorCode: "EXCHANGE_NOT_FOUND",
        errorMessage: "not found",
      });
    });

    it("returns a non-throwing result for a 409 (exchange not ready)", async () => {
      triggerIngestionMock.mockRejectedValue(
        new FakeLakehouseServiceError(409, "EXCHANGE_NOT_READY", "not ready"),
      );

      const service = new LakehouseAdminApiService();
      const result = await service.triggerIngestion("exc-1");

      expect(result.ok).toBe(false);
      expect(result.errorCode).toBe("EXCHANGE_NOT_READY");
    });

    it("rethrows on an unexpected (5xx) failure", async () => {
      triggerIngestionMock.mockRejectedValue(new FakeLakehouseServiceError(500, undefined, "boom"));

      const service = new LakehouseAdminApiService();
      await expect(service.triggerIngestion("exc-1")).rejects.toThrow("boom");
    });

    it("maps a successful outcome", async () => {
      triggerIngestionMock.mockResolvedValue({
        ingestion_id: "ing-1",
        exchange_id: "exc-1",
        status: "COMPLETED",
        bronze_table: "bronze.dp_1",
        source_record_count: 5,
        bronze_record_count: 5,
        rejected_record_count: 0,
        error_code: null,
        error_message: null,
      });

      const service = new LakehouseAdminApiService();
      const result = await service.triggerIngestion("exc-1");

      expect(result).toEqual({
        ok: true,
        status: "COMPLETED",
        errorCode: undefined,
        errorMessage: undefined,
      });
    });
  });
});
