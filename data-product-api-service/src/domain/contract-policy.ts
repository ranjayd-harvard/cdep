import { AppError } from "../common/errors/app-error.js";
import type { ApiContract } from "../ports/catalog-client.port.js";
import type { SecurityContext } from "../auth/request-context.js";
import { decodeCursor, filterFingerprint, type CursorPayload } from "./cursor.js";
import type { ProductQuery } from "./product-query.js";

const RESERVED_QUERY_PARAMS = new Set(["sort", "cursor", "page_size", "fields"]);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

function asString(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (Array.isArray(value)) {
    throw new AppError("INVALID_REQUEST", "Query parameters must not be repeated.");
  }
  return String(value);
}

function assertStrictDate(name: string, value: string): void {
  if (!DATE_RE.test(value)) {
    throw new AppError("INVALID_FILTER", `Filter '${name}' must be an ISO date (YYYY-MM-DD).`);
  }
  const [y, m, d] = value.split("-").map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    throw new AppError("INVALID_FILTER", `Filter '${name}' is not a valid calendar date.`);
  }
}

function assertStrictTimestamp(name: string, value: string): void {
  if (!TIMESTAMP_RE.test(value) || Number.isNaN(Date.parse(value))) {
    throw new AppError("INVALID_FILTER", `Filter '${name}' must be an ISO-8601 timestamp.`);
  }
}

// Turns an already-authenticated request's raw query string into a
// contract-allowlisted ProductQuery (spec §8.7/§8.8). Every branch that
// rejects does so with a stable error code from spec §8.10 — nothing here
// ever reaches a ServingStore query with an unvalidated value.
export function parseAndValidateQuery(
  contract: ApiContract,
  securityContext: Pick<SecurityContext, "organizationId" | "activeTenantId">,
  rawQuery: Record<string, unknown>,
  cursorSigningSecret: string,
): ProductQuery {
  const allowedFilters = new Set(contract.filters);
  const allowedSorts = new Set(contract.sorts);
  const publishedFieldNames = new Set(contract.publishedFields.map((f) => f.name));

  for (const key of Object.keys(rawQuery)) {
    if (RESERVED_QUERY_PARAMS.has(key)) continue;
    if (!allowedFilters.has(key)) {
      throw new AppError("INVALID_FILTER", `Filter '${key}' is not supported.`);
    }
  }

  const eventId = asString(rawQuery["event_id"]);
  const venueId = asString(rawQuery["venue_id"]);
  const eventDateFrom = asString(rawQuery["event_date_from"]);
  const eventDateTo = asString(rawQuery["event_date_to"]);
  const updatedSince = asString(rawQuery["updated_since"]);

  if (eventDateFrom) assertStrictDate("event_date_from", eventDateFrom);
  if (eventDateTo) assertStrictDate("event_date_to", eventDateTo);
  if (eventDateFrom && eventDateTo && eventDateFrom > eventDateTo) {
    throw new AppError("INVALID_REQUEST", "event_date_from must be <= event_date_to.");
  }
  if (updatedSince) assertStrictTimestamp("updated_since", updatedSince);

  const filters: ProductQuery["filters"] = {
    eventId,
    venueId,
    eventDateFrom,
    eventDateTo,
    updatedSince,
  };

  const rawSort = asString(rawQuery["sort"]);
  let sort: string[];
  if (rawSort) {
    sort = rawSort.split(",").map((s) => s.trim());
    for (const field of sort) {
      if (!allowedSorts.has(field)) {
        throw new AppError("INVALID_SORT", `Sort field '${field}' is not supported.`);
      }
    }
  } else {
    sort = [...contract.defaultSort];
  }
  // Deterministic ordering (spec §8.8): append any of the contract's
  // default sort fields not already present, so pagination never depends
  // on Postgres's unspecified tie-break order for rows with equal values
  // in the caller's requested sort columns.
  for (const field of contract.defaultSort) {
    if (!sort.includes(field)) sort.push(field);
  }

  const rawPageSize = asString(rawQuery["page_size"]);
  let pageSize = contract.defaultPageSize;
  if (rawPageSize !== undefined) {
    const parsed = Number(rawPageSize);
    if (!Number.isInteger(parsed) || parsed <= 0 || parsed > contract.maxPageSize) {
      throw new AppError("INVALID_PAGE_SIZE", `page_size must be an integer between 1 and ${contract.maxPageSize}.`);
    }
    pageSize = parsed;
  }

  const rawFields = asString(rawQuery["fields"]);
  let selectedFields: string[] | null = null;
  if (rawFields) {
    selectedFields = rawFields.split(",").map((s) => s.trim());
    for (const field of selectedFields) {
      if (!publishedFieldNames.has(field)) {
        throw new AppError("INVALID_FIELD_SELECTION", `Field '${field}' is not part of the published contract.`);
      }
    }
  }

  const rawCursor = asString(rawQuery["cursor"]);
  let cursor: CursorPayload | null = null;
  if (rawCursor) {
    cursor = decodeCursor(rawCursor, cursorSigningSecret);
    const expectedFingerprint = filterFingerprint(filters);
    if (
      cursor.organizationId !== securityContext.organizationId ||
      cursor.tenantId !== securityContext.activeTenantId ||
      cursor.productId !== contract.dataProductId ||
      cursor.productVersion !== contract.version ||
      cursor.filterFingerprint !== expectedFingerprint ||
      JSON.stringify(cursor.sort) !== JSON.stringify(sort)
    ) {
      // Deliberately generic: a cursor minted for a different tenant,
      // product, version, filter set, or sort order is indistinguishable
      // from a tampered one to the caller (spec §8.8 "a Tenant B cursor
      // must fail when used by Tenant A").
      throw new AppError("INVALID_CURSOR", "Cursor does not match the current request.");
    }
  }

  return {
    tenantContext: securityContext,
    productId: contract.dataProductId,
    productVersion: contract.version,
    resource: contract.resource,
    filters,
    sort,
    pageSize,
    cursor,
    selectedFields,
  };
}
