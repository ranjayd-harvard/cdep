import type pg from "pg";
import type { ProductQuery } from "../../domain/product-query.js";
import type { ServingEventRow, ServingQueryResult, ServingStore } from "../../ports/serving-store.port.js";

// The only column names this file ever emits into SQL are these
// hard-coded literals — sort field names from the request are looked up
// through this map, never concatenated directly, so no request input ever
// becomes part of a column/table identifier (spec §8.7 "arbitrary SQL is
// impossible").
const SORT_COLUMN_BY_FIELD: Record<string, string> = {
  event_date: "event_date",
  event_id: "event_id",
};

function sqlColumnForSortField(field: string): string {
  const column = SORT_COLUMN_BY_FIELD[field];
  if (!column) {
    // Unreachable given contract-policy.ts already restricts `sort` to
    // contract.sorts, and this resource's contract.sorts is a subset of
    // SORT_COLUMN_BY_FIELD's keys — fails loudly rather than building SQL
    // with an unknown identifier.
    throw new Error(`No serving-store column mapping for sort field '${field}'.`);
  }
  return column;
}

export class PostgresServingStore implements ServingStore {
  constructor(private readonly pool: pg.Pool) {}

  async queryEventPerformanceEvents(query: ProductQuery): Promise<ServingQueryResult> {
    const params: unknown[] = [query.tenantContext.organizationId, query.tenantContext.activeTenantId];
    const whereClauses = ["organization_id = $1", "tenant_id = $2"];

    if (query.filters.eventId) {
      params.push(query.filters.eventId);
      whereClauses.push(`event_id = $${params.length}`);
    }
    if (query.filters.venueId) {
      params.push(query.filters.venueId);
      whereClauses.push(`venue_id = $${params.length}`);
    }
    if (query.filters.eventDateFrom) {
      params.push(query.filters.eventDateFrom);
      whereClauses.push(`event_date >= $${params.length}`);
    }
    if (query.filters.eventDateTo) {
      params.push(query.filters.eventDateTo);
      whereClauses.push(`event_date <= $${params.length}`);
    }
    if (query.filters.updatedSince) {
      params.push(query.filters.updatedSince);
      whereClauses.push(`source_updated_at >= $${params.length}`);
    }

    const sortColumns = query.sort.map(sqlColumnForSortField);

    if (query.cursor) {
      // Keyset pagination (spec §8.8): for sort columns [c1, c2, ...] this
      // builds (c1 > v1) OR (c1 = v1 AND c2 > v2) OR (c1 = v1 AND c2 = v2
      // AND c3 > v3) ... — never OFFSET, so performance and correctness
      // don't degrade on deep pages.
      const lastValues = query.cursor.lastValues;
      const disjuncts: string[] = [];
      for (let i = 0; i < sortColumns.length; i++) {
        const equalities: string[] = [];
        for (let j = 0; j < i; j++) {
          const col = sortColumns[j] as string;
          params.push(lastValues[query.sort[j] as string]);
          equalities.push(`${col} = $${params.length}`);
        }
        const col = sortColumns[i] as string;
        params.push(lastValues[query.sort[i] as string]);
        equalities.push(`${col} > $${params.length}`);
        disjuncts.push(`(${equalities.join(" AND ")})`);
      }
      whereClauses.push(`(${disjuncts.join(" OR ")})`);
    }

    const orderBy = sortColumns.map((c) => `${c} ASC`).join(", ");
    params.push(query.pageSize + 1);
    const limitParamIndex = params.length;

    const sql = `
      SELECT event_id, venue_id, event_date, tickets_sold, gross_revenue, revenue_per_ticket, serving_snapshot_id
      FROM api_serving.event_performance_events
      WHERE ${whereClauses.join(" AND ")}
      ORDER BY ${orderBy}
      LIMIT $${limitParamIndex}
    `;

    const { rows } = await this.pool.query(sql, params);
    const hasMore = rows.length > query.pageSize;
    const pageRows = hasMore ? rows.slice(0, query.pageSize) : rows;

    const mapped: ServingEventRow[] = pageRows.map((r) => ({
      eventId: r.event_id,
      venueId: r.venue_id,
      eventDate: String(r.event_date),
      ticketsSold: r.tickets_sold === null ? null : Number(r.tickets_sold),
      grossRevenue: r.gross_revenue === null ? null : String(r.gross_revenue),
      revenuePerTicket: r.revenue_per_ticket === null ? null : String(r.revenue_per_ticket),
    }));

    const lastRow = pageRows.at(-1);
    const lastRowSortValues = lastRow ? query.sort.map((field) => sortValueFromRow(lastRow, field)) : null;
    const servingSnapshotId = pageRows[0] ? String(pageRows[0].serving_snapshot_id) : null;

    return { rows: mapped, hasMore, lastRowSortValues, servingSnapshotId };
  }
}

function sortValueFromRow(row: Record<string, unknown>, field: string): string {
  const column = sqlColumnForSortField(field);
  return String(row[column]);
}
