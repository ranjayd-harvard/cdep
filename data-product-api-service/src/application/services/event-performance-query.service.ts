import { AppError } from "../../common/errors/app-error.js";
import { encodeCursor, filterFingerprint } from "../../domain/cursor.js";
import { parseAndValidateQuery } from "../../domain/contract-policy.js";
import { projectRow } from "../../domain/response-projector.js";
import type { SecurityContext } from "../../auth/request-context.js";
import type { CatalogClient } from "../../ports/catalog-client.port.js";
import type { EntitlementClient } from "../../ports/entitlement-client.port.js";
import type { SubscriptionClient } from "../../ports/subscription-client.port.js";
import type { ServingStore } from "../../ports/serving-store.port.js";

export const DATA_PRODUCT_ID = "event-performance";
export const RESOURCE = "events";

// Lifecycle statuses an already-resolved, already-entitled subscription may
// still be served from. DRAFT (never activated) and RETIRED (sunset) are
// excluded — a subscription pinned to either resolves to PRODUCT_NOT_FOUND,
// the same as if the product/version didn't exist at all.
const SERVABLE_LIFECYCLE_STATUSES = new Set(["ACTIVE", "DEPRECATED", "BETA"]);

export interface EventPerformanceQueryDeps {
  catalogClient: CatalogClient;
  entitlementClient: EntitlementClient;
  subscriptionClient: SubscriptionClient;
  servingStore: ServingStore;
  cursorSigningSecret: string;
}

export interface EventPerformanceQueryResult {
  data: Array<Record<string, unknown>>;
  page: { nextCursor: string | null; pageSize: number };
  product: { id: string; version: string };
  freshness: { servingSnapshot: string | null; asOf: string };
  responseBytes: number;
}

// Runs the full Phase-8 sequence (spec §8.6/§8.7) in order: entitlement ->
// API-delivery-permission -> active-subscription -> version-resolution ->
// Catalog-contract -> allowlisted-query-validation -> serving query ->
// contract-driven projection -> cursor-paginated response. Authentication
// itself already happened in the route's preHandler before this runs.
//
// Every failure mode from "not entitled" through "subscription paused"
// through "API delivery not configured for this version" collapses to the
// same PRODUCT_NOT_FOUND the customer would see if the product genuinely
// didn't exist — deliberately: distinguishing "exists but you can't touch
// it" from "doesn't exist" would leak which products other tenants are
// entitled to, the same information-disclosure concern spec §8.10 calls
// out for cross-tenant resource enumeration.
export async function runEventPerformanceQuery(
  deps: EventPerformanceQueryDeps,
  securityContext: SecurityContext,
  requestedResource: string,
  rawQuery: Record<string, unknown>,
): Promise<EventPerformanceQueryResult> {
  const { organizationId, activeTenantId } = securityContext;

  const entitlement = await deps.entitlementClient.evaluate(organizationId, activeTenantId, DATA_PRODUCT_ID);
  if (entitlement.decision !== "ALLOW") {
    throw new AppError("PRODUCT_NOT_FOUND", `No entitlement for '${DATA_PRODUCT_ID}' (${entitlement.reason}).`);
  }

  const subscription = await deps.subscriptionClient.resolveForScope(organizationId, activeTenantId, DATA_PRODUCT_ID);
  if (!subscription || subscription.status !== "ACTIVE") {
    throw new AppError("PRODUCT_NOT_FOUND", `No active subscription to '${DATA_PRODUCT_ID}'.`);
  }
  if (subscription.deliveryMethod !== "API") {
    throw new AppError("PRODUCT_NOT_FOUND", `Subscription to '${DATA_PRODUCT_ID}' does not have API delivery configured.`);
  }
  if (!subscription.resolvedProductVersion) {
    throw new AppError("PRODUCT_NOT_FOUND", `'${DATA_PRODUCT_ID}' version policy did not resolve to a servable version.`);
  }
  if (!SERVABLE_LIFECYCLE_STATUSES.has(subscription.resolvedProductVersion.lifecycleStatus)) {
    throw new AppError("PRODUCT_NOT_FOUND", `Resolved version of '${DATA_PRODUCT_ID}' is not currently servable.`);
  }

  const contract = await deps.catalogClient.getApiContract(DATA_PRODUCT_ID, subscription.resolvedProductVersion.version);
  if (!contract) {
    throw new AppError("PRODUCT_NOT_FOUND", `'${DATA_PRODUCT_ID}' has no API contract for the resolved version.`);
  }
  if (contract.resource !== requestedResource) {
    throw new AppError("RESOURCE_NOT_FOUND", `Resource '${requestedResource}' does not exist on '${DATA_PRODUCT_ID}'.`);
  }

  const query = parseAndValidateQuery(contract, securityContext, rawQuery, deps.cursorSigningSecret);

  const result = await deps.servingStore.queryEventPerformanceEvents(query);
  const data = result.rows.map((row) => projectRow(row, contract, query.selectedFields));

  const responseBytes = Buffer.byteLength(JSON.stringify(data), "utf8");
  if (contract.maxResponseBytes !== null && responseBytes > contract.maxResponseBytes) {
    throw new AppError("RESPONSE_TOO_LARGE", `Response of ${responseBytes} bytes exceeds the ${contract.maxResponseBytes}-byte limit.`);
  }

  let nextCursor: string | null = null;
  if (result.hasMore && result.lastRowSortValues) {
    const lastValues: Record<string, string> = {};
    query.sort.forEach((field, i) => {
      lastValues[field] = result.lastRowSortValues![i] as string;
    });
    nextCursor = encodeCursor(
      {
        organizationId,
        tenantId: activeTenantId,
        productId: contract.dataProductId,
        productVersion: contract.version,
        sort: query.sort,
        filterFingerprint: filterFingerprint(query.filters),
        lastValues,
      },
      deps.cursorSigningSecret,
    );
  }

  return {
    data,
    page: { nextCursor, pageSize: query.pageSize },
    product: { id: contract.dataProductId, version: contract.version },
    freshness: { servingSnapshot: result.servingSnapshotId, asOf: new Date().toISOString() },
    responseBytes,
  };
}
