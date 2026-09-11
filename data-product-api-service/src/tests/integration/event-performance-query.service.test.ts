import { describe, expect, it } from "vitest";
import {
  runEventPerformanceQuery,
  runEventPerformanceQueryForExplicitVersion,
  type EventPerformanceQueryDeps,
} from "../../application/services/event-performance-query.service.js";
import { AppError } from "../../common/errors/app-error.js";
import type { SecurityContext } from "../../auth/request-context.js";
import type { CatalogClient, ApiContract } from "../../ports/catalog-client.port.js";
import type { EntitlementClient, EntitlementDecisionResult } from "../../ports/entitlement-client.port.js";
import type { SubscriptionClient, DeliveryContext } from "../../ports/subscription-client.port.js";
import type { ServingStore, ServingQueryResult } from "../../ports/serving-store.port.js";

const SECURITY_CONTEXT: SecurityContext = {
  subjectId: "usr-1",
  organizationId: "org-a",
  activeTenantId: "tenant-a",
  roles: ["CUSTOMER_ADMIN"],
  authenticationMethod: "DEV_TOKEN",
};

const CONTRACT: ApiContract = {
  dataProductId: "event-performance",
  version: "1.0.0",
  lifecycleStatus: "ACTIVE",
  resource: "events",
  publishedFields: [{ name: "event_id", type: "string", nullable: false , maskingPolicy: null }],
  filters: [],
  sorts: ["event_date", "event_id"],
  defaultSort: ["event_date", "event_id"],
  defaultPageSize: 100,
  maxPageSize: 500,
  maxResponseBytes: 5_000_000,
  freshnessMinutes: 240,
};

const ACTIVE_SUBSCRIPTION: DeliveryContext = {
  subscriptionId: "sub-1",
  organizationId: "org-a",
  tenantId: "tenant-a",
  dataProductId: "event-performance",
  status: "ACTIVE",
  resolvedProductVersion: { version: "1.0.0", lifecycleStatus: "ACTIVE" },
  deliveryMethod: "API",
};

const EMPTY_RESULT: ServingQueryResult = { rows: [], hasMore: false, lastRowSortValues: null, servingSnapshotId: "snap-1" };

function makeDeps(overrides: Partial<{
  entitlement: EntitlementDecisionResult;
  subscription: DeliveryContext | null;
  contract: ApiContract | null;
  servingResult: ServingQueryResult;
  resolvedExplicit: { version: string; lifecycleStatus: string } | null;
}> = {}): EventPerformanceQueryDeps {
  const entitlement = overrides.entitlement ?? { decision: "ALLOW", reason: "ACTIVE_ENTITLEMENT", entitlementId: "ent-1" };
  const subscription = ("subscription" in overrides ? overrides.subscription : ACTIVE_SUBSCRIPTION) as DeliveryContext | null;
  const contract = ("contract" in overrides ? overrides.contract : CONTRACT) as ApiContract | null;
  const servingResult = overrides.servingResult ?? EMPTY_RESULT;
  const resolvedExplicit =
    "resolvedExplicit" in overrides ? overrides.resolvedExplicit : contract ? { version: contract.version, lifecycleStatus: contract.lifecycleStatus } : null;

  const catalogClient: CatalogClient = {
    getApiContract: async () => contract,
    resolveExactVersion: async () => resolvedExplicit ?? null,
  };
  const entitlementClient: EntitlementClient = { evaluate: async () => entitlement };
  const subscriptionClient: SubscriptionClient = { resolveForScope: async () => subscription };
  const servingStore: ServingStore = { queryEventPerformanceEvents: async () => servingResult };

  return { catalogClient, entitlementClient, subscriptionClient, servingStore, cursorSigningSecret: "test-secret-at-least-16-chars" };
}

async function expectProductNotFound(deps: EventPerformanceQueryDeps) {
  await expect(runEventPerformanceQuery(deps, SECURITY_CONTEXT, "events", {})).rejects.toMatchObject(
    expect.objectContaining({ code: "PRODUCT_NOT_FOUND" }),
  );
}

describe("runEventPerformanceQuery", () => {
  it("succeeds on the full happy path", async () => {
    const result = await runEventPerformanceQuery(makeDeps(), SECURITY_CONTEXT, "events", {});
    expect(result.product).toEqual({ id: "event-performance", version: "1.0.0" });
    expect(result.data).toEqual([]);
  });

  it("maps DENY entitlement to PRODUCT_NOT_FOUND — never a distinct 403", async () => {
    await expectProductNotFound(makeDeps({ entitlement: { decision: "DENY", reason: "NO_ENTITLEMENT", entitlementId: null } }));
  });

  it("maps no subscription to PRODUCT_NOT_FOUND", async () => {
    await expectProductNotFound(makeDeps({ subscription: null }));
  });

  it("maps an inactive (PAUSED) subscription to PRODUCT_NOT_FOUND", async () => {
    await expectProductNotFound(makeDeps({ subscription: { ...ACTIVE_SUBSCRIPTION, status: "PAUSED" } }));
  });

  it("maps a FILE-only subscription (no API delivery) to PRODUCT_NOT_FOUND", async () => {
    await expectProductNotFound(makeDeps({ subscription: { ...ACTIVE_SUBSCRIPTION, deliveryMethod: "FILE" } }));
  });

  it("maps an unresolved version policy to PRODUCT_NOT_FOUND", async () => {
    await expectProductNotFound(makeDeps({ subscription: { ...ACTIVE_SUBSCRIPTION, resolvedProductVersion: null } }));
  });

  it("maps a DRAFT resolved version to PRODUCT_NOT_FOUND", async () => {
    await expectProductNotFound(makeDeps({ subscription: { ...ACTIVE_SUBSCRIPTION, resolvedProductVersion: { version: "2.0.0", lifecycleStatus: "DRAFT" } } }));
  });

  it("maps a RETIRED resolved version to PRODUCT_NOT_FOUND", async () => {
    await expectProductNotFound(makeDeps({ subscription: { ...ACTIVE_SUBSCRIPTION, resolvedProductVersion: { version: "0.9.0", lifecycleStatus: "RETIRED" } } }));
  });

  it("serves a DEPRECATED resolved version normally", async () => {
    const deps = makeDeps({ contract: { ...CONTRACT, lifecycleStatus: "DEPRECATED" }, subscription: { ...ACTIVE_SUBSCRIPTION, resolvedProductVersion: { version: "1.0.0", lifecycleStatus: "DEPRECATED" } } });
    const result = await runEventPerformanceQuery(deps, SECURITY_CONTEXT, "events", {});
    expect(result.product.version).toBe("1.0.0");
  });

  it("maps a missing Catalog contract to PRODUCT_NOT_FOUND", async () => {
    await expectProductNotFound(makeDeps({ contract: null }));
  });

  it("maps a resource mismatch to RESOURCE_NOT_FOUND", async () => {
    await expect(runEventPerformanceQuery(makeDeps(), SECURITY_CONTEXT, "tickets", {})).rejects.toMatchObject(
      expect.objectContaining({ code: "RESOURCE_NOT_FOUND" }),
    );
  });

  it("rejects a response exceeding the contract's max-response-bytes", async () => {
    const bigRows = Array.from({ length: 100 }, (_, i) => ({
      eventId: `EVT${i}`,
      venueId: "VEN001",
      eventDate: "2026-09-01",
      ticketsSold: 1,
      grossRevenue: "1.00",
      revenuePerTicket: "1.00",
    }));
    const deps = makeDeps({
      contract: { ...CONTRACT, maxResponseBytes: 10, publishedFields: [{ name: "event_id", type: "string", nullable: false , maskingPolicy: null }] },
      servingResult: { rows: bigRows, hasMore: false, lastRowSortValues: null, servingSnapshotId: "snap-1" },
    });
    await expect(runEventPerformanceQuery(deps, SECURITY_CONTEXT, "events", {})).rejects.toMatchObject(
      expect.objectContaining({ code: "RESPONSE_TOO_LARGE" }),
    );
  });

  it("propagates AppError from query validation unchanged (e.g. INVALID_FILTER)", async () => {
    await expect(runEventPerformanceQuery(makeDeps(), SECURITY_CONTEXT, "events", { not_a_real_filter: "x" })).rejects.toBeInstanceOf(AppError);
  });
});

// Phase 10 §38: explicit-version route — resolves via Catalog's resolver
// (EXACT/DELIVER) instead of the subscription's stored floating policy,
// but still requires the same entitlement/active-subscription gate.
describe("runEventPerformanceQueryForExplicitVersion", () => {
  it("serves a specific version once entitlement + active subscription + resolution all succeed", async () => {
    const deps = makeDeps({ resolvedExplicit: { version: "1.2.0", lifecycleStatus: "DEPRECATED" }, contract: { ...CONTRACT, version: "1.2.0" } });
    const result = await runEventPerformanceQueryForExplicitVersion(deps, SECURITY_CONTEXT, "events", "1.2.0", {});
    expect(result.product.version).toBe("1.2.0");
  });

  it("requires entitlement even when a version is named explicitly in the URL", async () => {
    const deps = makeDeps({ entitlement: { decision: "DENY", reason: "NO_ENTITLEMENT", entitlementId: null } });
    await expect(runEventPerformanceQueryForExplicitVersion(deps, SECURITY_CONTEXT, "events", "1.0.0", {})).rejects.toMatchObject(
      expect.objectContaining({ code: "PRODUCT_NOT_FOUND" }),
    );
  });

  it("requires an active API subscription even when a version is named explicitly", async () => {
    const deps = makeDeps({ subscription: null });
    await expect(runEventPerformanceQueryForExplicitVersion(deps, SECURITY_CONTEXT, "events", "1.0.0", {})).rejects.toMatchObject(
      expect.objectContaining({ code: "PRODUCT_NOT_FOUND" }),
    );
  });

  it("404s when the resolver rejects the version (DRAFT/RETIRED/BETA-without-opt-in)", async () => {
    const deps = makeDeps({ resolvedExplicit: null });
    await expect(runEventPerformanceQueryForExplicitVersion(deps, SECURITY_CONTEXT, "events", "9.9.9", {})).rejects.toMatchObject(
      expect.objectContaining({ code: "PRODUCT_NOT_FOUND" }),
    );
  });
});
