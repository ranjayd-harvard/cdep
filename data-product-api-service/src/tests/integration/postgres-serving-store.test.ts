import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { servingStorePool } from "../../database/pool.js";
import { PostgresServingStore } from "../../infrastructure/persistence/postgres-serving-store.js";
import { truncateServingStore } from "../setup/db.js";
import type { ProductQuery } from "../../domain/product-query.js";

const store = new PostgresServingStore(servingStorePool);

const TENANT_A = { organizationId: "org-int-a", activeTenantId: "tenant-int-a" };
const TENANT_B = { organizationId: "org-int-b", activeTenantId: "tenant-int-b" };

async function insertRow(input: {
  organizationId: string;
  tenantId: string;
  eventId: string;
  venueId: string;
  eventDate: string;
  ticketsSold: number;
  grossRevenue: string;
}): Promise<void> {
  await servingStorePool.query(
    `INSERT INTO api_serving.event_performance_events
       (organization_id, tenant_id, product_version, event_id, venue_id, event_date, tickets_sold, gross_revenue, revenue_per_ticket,
        source_updated_at, serving_snapshot_id, source_change_token)
     VALUES ($1, $2, '1.0.0', $3, $4, $5, $6, $7, $7, now(), 'snap-test', 'token-test')`,
    [input.organizationId, input.tenantId, input.eventId, input.venueId, input.eventDate, input.ticketsSold, input.grossRevenue],
  );
}

function baseQuery(overrides: Partial<ProductQuery> = {}): ProductQuery {
  return {
    tenantContext: TENANT_A,
    productId: "event-performance",
    productVersion: "1.0.0",
    resource: "events",
    filters: {},
    sort: ["event_date", "event_id"],
    pageSize: 100,
    cursor: null,
    selectedFields: null,
    ...overrides,
  };
}

describe("PostgresServingStore", () => {
  beforeEach(async () => {
    await truncateServingStore();
  });

  afterAll(async () => {
    await truncateServingStore();
    await servingStorePool.end();
  });

  it("scopes every query by organization_id + tenant_id — never returns another tenant's rows", async () => {
    await insertRow({ organizationId: TENANT_A.organizationId, tenantId: TENANT_A.activeTenantId, eventId: "EVT1001", venueId: "VEN001", eventDate: "2026-09-01", ticketsSold: 1200, grossRevenue: "84000.00" });
    await insertRow({ organizationId: TENANT_B.organizationId, tenantId: TENANT_B.activeTenantId, eventId: "EVT1001", venueId: "VEN999", eventDate: "2026-09-01", ticketsSold: 3000, grossRevenue: "250000.00" });

    const resultA = await store.queryEventPerformanceEvents(baseQuery({ tenantContext: TENANT_A }));
    const resultB = await store.queryEventPerformanceEvents(baseQuery({ tenantContext: TENANT_B }));

    expect(resultA.rows).toHaveLength(1);
    expect(resultA.rows[0]?.venueId).toBe("VEN001");
    expect(resultB.rows).toHaveLength(1);
    expect(resultB.rows[0]?.venueId).toBe("VEN999");
  });

  it("filters by event_id and venue_id", async () => {
    await insertRow({ organizationId: TENANT_A.organizationId, tenantId: TENANT_A.activeTenantId, eventId: "EVT1001", venueId: "VEN001", eventDate: "2026-09-01", ticketsSold: 1, grossRevenue: "1.00" });
    await insertRow({ organizationId: TENANT_A.organizationId, tenantId: TENANT_A.activeTenantId, eventId: "EVT1002", venueId: "VEN002", eventDate: "2026-09-02", ticketsSold: 1, grossRevenue: "1.00" });

    const byEventId = await store.queryEventPerformanceEvents(baseQuery({ filters: { eventId: "EVT1002" } }));
    expect(byEventId.rows.map((r) => r.eventId)).toEqual(["EVT1002"]);

    const byVenue = await store.queryEventPerformanceEvents(baseQuery({ filters: { venueId: "VEN001" } }));
    expect(byVenue.rows.map((r) => r.eventId)).toEqual(["EVT1001"]);
  });

  it("filters by event_date range (inclusive)", async () => {
    for (const [id, date] of [["E1", "2026-09-01"], ["E2", "2026-09-05"], ["E3", "2026-09-10"]] as const) {
      await insertRow({ organizationId: TENANT_A.organizationId, tenantId: TENANT_A.activeTenantId, eventId: id, venueId: "VEN001", eventDate: date, ticketsSold: 1, grossRevenue: "1.00" });
    }
    const result = await store.queryEventPerformanceEvents(baseQuery({ filters: { eventDateFrom: "2026-09-02", eventDateTo: "2026-09-10" } }));
    expect(result.rows.map((r) => r.eventId).sort()).toEqual(["E2", "E3"]);
  });

  it("paginates deterministically with no duplicates and no skipped rows across many identical dates", async () => {
    // All ten rows share the same event_date -- pagination correctness must
    // come entirely from the event_id tiebreak, not from Postgres's
    // unspecified default ordering.
    for (let i = 0; i < 10; i++) {
      await insertRow({
        organizationId: TENANT_A.organizationId,
        tenantId: TENANT_A.activeTenantId,
        eventId: `EVT${String(i).padStart(4, "0")}`,
        venueId: "VEN001",
        eventDate: "2026-09-01",
        ticketsSold: i,
        grossRevenue: "1.00",
      });
    }

    const seen: string[] = [];
    let cursorValues: string[] | null = null;
    for (let page = 0; page < 20; page++) {
      const query = baseQuery({
        pageSize: 3,
        cursor: cursorValues ? { organizationId: TENANT_A.organizationId, tenantId: TENANT_A.activeTenantId, productId: "event-performance", productVersion: "1.0.0", sort: ["event_date", "event_id"], filterFingerprint: "", lastValues: { event_date: cursorValues[0] as string, event_id: cursorValues[1] as string } } : null,
      });
      const result = await store.queryEventPerformanceEvents(query);
      seen.push(...result.rows.map((r) => r.eventId));
      if (!result.hasMore) break;
      cursorValues = result.lastRowSortValues as string[];
    }

    expect(seen).toHaveLength(10);
    expect(new Set(seen).size).toBe(10);
    expect(seen).toEqual([...seen].sort());
  });

  it("hasMore is false on the last page and true otherwise", async () => {
    for (let i = 0; i < 3; i++) {
      await insertRow({ organizationId: TENANT_A.organizationId, tenantId: TENANT_A.activeTenantId, eventId: `E${i}`, venueId: "VEN001", eventDate: "2026-09-01", ticketsSold: 1, grossRevenue: "1.00" });
    }
    const first = await store.queryEventPerformanceEvents(baseQuery({ pageSize: 2 }));
    expect(first.hasMore).toBe(true);
    expect(first.rows).toHaveLength(2);

    const second = await store.queryEventPerformanceEvents(
      baseQuery({ pageSize: 2, cursor: { organizationId: TENANT_A.organizationId, tenantId: TENANT_A.activeTenantId, productId: "event-performance", productVersion: "1.0.0", sort: ["event_date", "event_id"], filterFingerprint: "", lastValues: { event_date: first.lastRowSortValues![0] as string, event_id: first.lastRowSortValues![1] as string } } }),
    );
    expect(second.hasMore).toBe(false);
    expect(second.rows).toHaveLength(1);
  });
});
