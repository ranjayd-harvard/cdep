import { describe, expect, it } from "vitest";
import { projectRow } from "../../domain/response-projector.js";
import type { ApiContract } from "../../ports/catalog-client.port.js";
import type { ServingEventRow } from "../../ports/serving-store.port.js";

const CONTRACT: ApiContract = {
  dataProductId: "event-performance",
  version: "1.0.0",
  lifecycleStatus: "ACTIVE",
  resource: "events",
  publishedFields: [
    { name: "event_id", type: "string", nullable: false , maskingPolicy: null },
    { name: "venue_id", type: "string", nullable: false , maskingPolicy: null },
    { name: "event_date", type: "date", nullable: false , maskingPolicy: null },
    { name: "tickets_sold", type: "long", nullable: true , maskingPolicy: null },
    { name: "gross_revenue", type: "decimal(18,2)", nullable: true , maskingPolicy: null },
    { name: "revenue_per_ticket", type: "decimal(18,2)", nullable: true , maskingPolicy: null },
  ],
  filters: [],
  sorts: [],
  defaultSort: [],
  defaultPageSize: 100,
  maxPageSize: 500,
  maxResponseBytes: null,
  freshnessMinutes: null,
};

// Simulates a serving row that carries internal fields no accessor map
// entry exists for (spec §8.18's regression scenario: adding a new
// serving-table column must not automatically expose it).
const ROW = {
  eventId: "EVT1001",
  venueId: "VEN001",
  eventDate: "2026-09-01",
  ticketsSold: 1200,
  grossRevenue: "84000.00",
  revenuePerTicket: "70.00",
  organizationId: "org-a",
  tenantId: "tenant-a",
  goldPipelineRunId: "gpr-1",
} as unknown as ServingEventRow;

describe("projectRow", () => {
  it("emits exactly the published fields for the full contract", () => {
    const projected = projectRow(ROW, CONTRACT, null);
    expect(Object.keys(projected).sort()).toEqual(
      ["event_id", "venue_id", "event_date", "tickets_sold", "gross_revenue", "revenue_per_ticket"].sort(),
    );
  });

  it("never emits internal fields even though they exist on the row", () => {
    const projected = projectRow(ROW, CONTRACT, null);
    expect(projected).not.toHaveProperty("organizationId");
    expect(projected).not.toHaveProperty("organization_id");
    expect(projected).not.toHaveProperty("tenantId");
    expect(projected).not.toHaveProperty("tenant_id");
    expect(projected).not.toHaveProperty("goldPipelineRunId");
    expect(projected).not.toHaveProperty("_gold_pipeline_run_id");
  });

  it("field selection only ever reduces the published set", () => {
    const projected = projectRow(ROW, CONTRACT, ["event_id", "venue_id"]);
    expect(Object.keys(projected).sort()).toEqual(["event_id", "venue_id"]);
  });

  it("a field name with no accessor is silently omitted, not thrown", () => {
    // Regression guard: even if contract-policy.ts's allowlist were ever
    // bypassed (defense in depth), the projector itself still cannot be
    // made to emit an arbitrary field name.
    const projected = projectRow(ROW, CONTRACT, ["event_id", "storage_path"]);
    expect(projected).toEqual({ event_id: "EVT1001" });
  });

  it("applies REDACT/HASH/MASK per the contract's maskingPolicy (spec §21)", () => {
    const maskedContract: ApiContract = {
      ...CONTRACT,
      publishedFields: [
        { name: "event_id", type: "string", nullable: false, maskingPolicy: "REDACT" },
        { name: "venue_id", type: "string", nullable: false, maskingPolicy: "HASH" },
        { name: "event_date", type: "date", nullable: false, maskingPolicy: "MASK" },
        { name: "tickets_sold", type: "long", nullable: true, maskingPolicy: null },
      ],
    };
    const projected = projectRow(ROW, maskedContract, null);
    expect(projected.event_id).toBe("***REDACTED***");
    expect(projected.venue_id).toMatch(/^[a-f0-9]{64}$/);
    expect(projected.event_date).toBe("***9-01");
    expect(projected.tickets_sold).toBe(1200);
  });
});
