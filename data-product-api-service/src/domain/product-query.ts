import type { SecurityContext } from "../auth/request-context.js";
import type { CursorPayload } from "./cursor.js";

// The typed internal query model (spec §8.7) — the only shape that ever
// reaches a ServingStore implementation. Filters/sort/selectedFields are
// already allowlist-validated by the time this is constructed; a
// ServingStore implementation trusts it completely and still only ever
// binds these as parameterized values, never string-interpolates them.
export interface ProductQuery {
  tenantContext: Pick<SecurityContext, "organizationId" | "activeTenantId">;
  productId: string;
  productVersion: string;
  resource: string;
  filters: {
    eventId?: string;
    venueId?: string;
    eventDateFrom?: string;
    eventDateTo?: string;
    updatedSince?: string;
  };
  sort: string[];
  pageSize: number;
  cursor: CursorPayload | null;
  selectedFields: string[] | null;
}
