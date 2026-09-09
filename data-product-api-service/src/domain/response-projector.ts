import type { ApiContract } from "../ports/catalog-client.port.js";
import type { ServingEventRow } from "../ports/serving-store.port.js";

// Serving Row -> Published Catalog Contract -> Response Projector ->
// Customer Response (spec §8.9). This is the ONLY place a serving row is
// turned into JSON — every field emitted here is looked up by name from
// `contract.publishedFields`, so a new serving-table column can never leak
// through the API just by existing (spec §8.18's regression test asserts
// exactly this).
const FIELD_ACCESSORS: Record<string, (row: ServingEventRow) => unknown> = {
  event_id: (row) => row.eventId,
  venue_id: (row) => row.venueId,
  event_date: (row) => row.eventDate,
  tickets_sold: (row) => row.ticketsSold,
  gross_revenue: (row) => row.grossRevenue,
  revenue_per_ticket: (row) => row.revenuePerTicket,
};

export function projectRow(row: ServingEventRow, contract: ApiContract, selectedFields: string[] | null): Record<string, unknown> {
  const fieldNames = selectedFields ?? contract.publishedFields.map((f) => f.name);
  const out: Record<string, unknown> = {};
  for (const name of fieldNames) {
    const accessor = FIELD_ACCESSORS[name];
    // Unreachable in practice — contract-policy.ts already restricts
    // selectedFields to contract.publishedFields, and publishedFields is
    // itself restricted to names FIELD_ACCESSORS knows about for this
    // resource. Fails closed (omits the field) rather than throwing, so a
    // future contract field this resource's accessor map hasn't caught up
    // to degrades safely instead of 500ing every request.
    if (!accessor) continue;
    out[name] = accessor(row);
  }
  return out;
}
