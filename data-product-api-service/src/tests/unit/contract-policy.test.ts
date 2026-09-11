import { describe, expect, it } from "vitest";
import { parseAndValidateQuery } from "../../domain/contract-policy.js";
import { encodeCursor, filterFingerprint } from "../../domain/cursor.js";
import { AppError } from "../../common/errors/app-error.js";
import type { ApiContract } from "../../ports/catalog-client.port.js";

const SECRET = "test-secret-at-least-16-chars";
const SECURITY_CONTEXT = { organizationId: "org-a", activeTenantId: "tenant-a" };

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
  filters: ["event_id", "venue_id", "event_date_from", "event_date_to", "updated_since"],
  sorts: ["event_date", "event_id"],
  defaultSort: ["event_date", "event_id"],
  defaultPageSize: 100,
  maxPageSize: 500,
  maxResponseBytes: 5_000_000,
  freshnessMinutes: 240,
};

function expectAppError(fn: () => unknown, code: string) {
  try {
    fn();
    throw new Error("expected to throw");
  } catch (err) {
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe(code);
  }
}

describe("parseAndValidateQuery", () => {
  it("accepts an empty query and applies contract defaults", () => {
    const query = parseAndValidateQuery(CONTRACT, SECURITY_CONTEXT, {}, SECRET);
    expect(query.pageSize).toBe(100);
    expect(query.sort).toEqual(["event_date", "event_id"]);
    expect(query.selectedFields).toBeNull();
    expect(query.cursor).toBeNull();
  });

  it("rejects a filter not in the contract (e.g. gross_revenue_gt)", () => {
    expectAppError(() => parseAndValidateQuery(CONTRACT, SECURITY_CONTEXT, { gross_revenue_gt: "50000" }, SECRET), "INVALID_FILTER");
  });

  it("rejects tenant_id as a query filter — tenant identity never comes from query params", () => {
    expectAppError(() => parseAndValidateQuery(CONTRACT, SECURITY_CONTEXT, { tenant_id: "tenant-b" }, SECRET), "INVALID_FILTER");
  });

  it("rejects an unsupported sort field", () => {
    expectAppError(() => parseAndValidateQuery(CONTRACT, SECURITY_CONTEXT, { sort: "gross_revenue" }, SECRET), "INVALID_SORT");
  });

  it("rejects a malformed event_date_from", () => {
    expectAppError(() => parseAndValidateQuery(CONTRACT, SECURITY_CONTEXT, { event_date_from: "09-01-2026" }, SECRET), "INVALID_FILTER");
  });

  it("rejects an impossible calendar date", () => {
    expectAppError(() => parseAndValidateQuery(CONTRACT, SECURITY_CONTEXT, { event_date_from: "2026-02-30" }, SECRET), "INVALID_FILTER");
  });

  it("rejects event_date_from after event_date_to", () => {
    expectAppError(
      () => parseAndValidateQuery(CONTRACT, SECURITY_CONTEXT, { event_date_from: "2026-09-10", event_date_to: "2026-09-01" }, SECRET),
      "INVALID_REQUEST",
    );
  });

  it("rejects a malformed updated_since timestamp", () => {
    expectAppError(() => parseAndValidateQuery(CONTRACT, SECURITY_CONTEXT, { updated_since: "not-a-timestamp" }, SECRET), "INVALID_FILTER");
  });

  it("rejects page_size above the contract maximum", () => {
    expectAppError(() => parseAndValidateQuery(CONTRACT, SECURITY_CONTEXT, { page_size: "501" }, SECRET), "INVALID_PAGE_SIZE");
  });

  it("rejects a non-integer or zero page_size", () => {
    expectAppError(() => parseAndValidateQuery(CONTRACT, SECURITY_CONTEXT, { page_size: "0" }, SECRET), "INVALID_PAGE_SIZE");
    expectAppError(() => parseAndValidateQuery(CONTRACT, SECURITY_CONTEXT, { page_size: "abc" }, SECRET), "INVALID_PAGE_SIZE");
  });

  it("allows field selection to reduce the published schema", () => {
    const query = parseAndValidateQuery(CONTRACT, SECURITY_CONTEXT, { fields: "event_id,venue_id" }, SECRET);
    expect(query.selectedFields).toEqual(["event_id", "venue_id"]);
  });

  it("rejects field selection naming an internal field (e.g. tenant_id)", () => {
    expectAppError(() => parseAndValidateQuery(CONTRACT, SECURITY_CONTEXT, { fields: "event_id,tenant_id" }, SECRET), "INVALID_FIELD_SELECTION");
  });

  it("accepts a cursor that matches the current tenant/product/version/sort/filters", () => {
    const filters = { eventId: undefined, venueId: undefined, eventDateFrom: undefined, eventDateTo: undefined, updatedSince: undefined };
    const cursor = encodeCursor(
      {
        organizationId: "org-a",
        tenantId: "tenant-a",
        productId: "event-performance",
        productVersion: "1.0.0",
        sort: ["event_date", "event_id"],
        filterFingerprint: filterFingerprint(filters),
        lastValues: { event_date: "2026-09-01", event_id: "EVT1001" },
      },
      SECRET,
    );
    const query = parseAndValidateQuery(CONTRACT, SECURITY_CONTEXT, { cursor }, SECRET);
    expect(query.cursor?.lastValues).toEqual({ event_date: "2026-09-01", event_id: "EVT1001" });
  });

  it("rejects a cursor minted for a different tenant", () => {
    const filters = { eventId: undefined, venueId: undefined, eventDateFrom: undefined, eventDateTo: undefined, updatedSince: undefined };
    const cursor = encodeCursor(
      {
        organizationId: "org-a",
        tenantId: "tenant-OTHER",
        productId: "event-performance",
        productVersion: "1.0.0",
        sort: ["event_date", "event_id"],
        filterFingerprint: filterFingerprint(filters),
        lastValues: { event_date: "2026-09-01", event_id: "EVT1001" },
      },
      SECRET,
    );
    expectAppError(() => parseAndValidateQuery(CONTRACT, SECURITY_CONTEXT, { cursor }, SECRET), "INVALID_CURSOR");
  });

  it("rejects a cursor minted for a different filter set", () => {
    const filters = { eventId: "EVT1001" };
    const cursor = encodeCursor(
      {
        organizationId: "org-a",
        tenantId: "tenant-a",
        productId: "event-performance",
        productVersion: "1.0.0",
        sort: ["event_date", "event_id"],
        filterFingerprint: filterFingerprint(filters),
        lastValues: { event_date: "2026-09-01", event_id: "EVT1001" },
      },
      SECRET,
    );
    // Same cursor, but this request has no filters at all.
    expectAppError(() => parseAndValidateQuery(CONTRACT, SECURITY_CONTEXT, { cursor }, SECRET), "INVALID_CURSOR");
  });
});
