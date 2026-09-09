"use client";

import { Fragment, useMemo, useState } from "react";
import {
  Select,
  Input,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableHeaderCell,
  TableCell,
  StatusBadge,
  EmptyState,
  Button,
} from "@/components/ui";
import type { AdminExchangeIngestionRow } from "@/services/interfaces";
import { triggerBronzeToSilverAction, triggerIngestionAction } from "./actions";

const ALL_VALUE = "ALL";
const NEVER_INGESTED_VALUE = "NEVER_INGESTED";
const ORG_TENANT_SEPARATOR = "::";

// Sticky so "Run ingestion" stays reachable without scrolling the table
// horizontally — every other column can grow (org/tenant ids, bronze
// table names, ...) without pushing the action off-screen.
const STICKY_ACTIONS_CELL = "sticky right-0 border-l border-slate-200";

// Tighter padding than the default TableCell/TableHeaderCell (px-4 py-3) so
// more rows fit on screen; details that don't fit move into the expandable
// panel below each row instead of a wider cell.
const COMPACT_CELL = "!py-2";

type SortColumn = "createdAt" | "exchangeId" | "dataProductId";
type SortDirection = "asc" | "desc";

function orgTenantKey(row: AdminExchangeIngestionRow) {
  return `${row.organizationId}${ORG_TENANT_SEPARATOR}${row.tenantId}`;
}

export function IngestionTable({ items }: { items: AdminExchangeIngestionRow[] }) {
  const [search, setSearch] = useState("");
  const [direction, setDirection] = useState(ALL_VALUE);
  const [ingestionStatus, setIngestionStatus] = useState(ALL_VALUE);
  const [dataProductId, setDataProductId] = useState(ALL_VALUE);
  const [orgTenant, setOrgTenant] = useState(ALL_VALUE);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [sortColumn, setSortColumn] = useState<SortColumn>("createdAt");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const dataProductOptions = useMemo(() => {
    const unique = Array.from(new Set(items.map((row) => row.dataProductId))).sort();
    return [
      { value: ALL_VALUE, label: "All Data Products" },
      ...unique.map((id) => ({ value: id, label: id })),
    ];
  }, [items]);

  const orgTenantOptions = useMemo(() => {
    const unique = new Map<string, string>();
    for (const row of items) {
      unique.set(orgTenantKey(row), `${row.organizationId} / ${row.tenantId}`);
    }
    return [
      { value: ALL_VALUE, label: "All Orgs / Tenants" },
      ...Array.from(unique.entries())
        .sort((a, b) => a[1].localeCompare(b[1]))
        .map(([value, label]) => ({ value, label })),
    ];
  }, [items]);

  const handleSort = (column: SortColumn) => {
    if (column === sortColumn) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortColumn(column);
      setSortDirection("asc");
    }
  };

  const toggleExpanded = (exchangeId: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(exchangeId)) {
        next.delete(exchangeId);
      } else {
        next.add(exchangeId);
      }
      return next;
    });
  };

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    const fromTime = dateFrom ? new Date(dateFrom).getTime() : null;
    // Include the entire "to" day rather than stopping at midnight.
    const toTime = dateTo ? new Date(dateTo).getTime() + 24 * 60 * 60 * 1000 - 1 : null;

    const rows = items.filter((row) => {
      const matchesSearch =
        !query ||
        row.exchangeId.toLowerCase().includes(query) ||
        row.dataProductId.toLowerCase().includes(query) ||
        (row.filename?.toLowerCase().includes(query) ?? false);
      const matchesDirection = direction === ALL_VALUE || row.direction === direction;
      const rowIngestionStatus = row.ingestion?.status ?? NEVER_INGESTED_VALUE;
      const matchesIngestion = ingestionStatus === ALL_VALUE || rowIngestionStatus === ingestionStatus;
      const matchesDataProduct = dataProductId === ALL_VALUE || row.dataProductId === dataProductId;
      const matchesOrgTenant = orgTenant === ALL_VALUE || orgTenantKey(row) === orgTenant;
      const createdTime = new Date(row.createdAt).getTime();
      const matchesFrom = fromTime === null || createdTime >= fromTime;
      const matchesTo = toTime === null || createdTime <= toTime;
      return (
        matchesSearch &&
        matchesDirection &&
        matchesIngestion &&
        matchesDataProduct &&
        matchesOrgTenant &&
        matchesFrom &&
        matchesTo
      );
    });

    const sorted = [...rows].sort((a, b) => {
      let comparison = 0;
      if (sortColumn === "createdAt") {
        comparison = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      } else {
        comparison = a[sortColumn].localeCompare(b[sortColumn]);
      }
      return sortDirection === "asc" ? comparison : -comparison;
    });

    return sorted;
  }, [
    items,
    search,
    direction,
    ingestionStatus,
    dataProductId,
    orgTenant,
    dateFrom,
    dateTo,
    sortColumn,
    sortDirection,
  ]);

  const allExpanded = filtered.length > 0 && filtered.every((row) => expandedIds.has(row.exchangeId));

  const sortOptions: { value: SortColumn; label: string }[] = [
    { value: "createdAt", label: "Created" },
    { value: "exchangeId", label: "Exchange ID" },
    { value: "dataProductId", label: "Data Product" },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <Input
          aria-label="Search by filename, exchange ID, or data product"
          placeholder="Search filename, exchange ID, or data product…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <Select
          aria-label="Filter by direction"
          value={direction}
          onChange={(event) => setDirection(event.target.value)}
          options={[
            { value: ALL_VALUE, label: "All Directions" },
            { value: "INBOUND", label: "Inbound" },
            { value: "OUTBOUND", label: "Outbound" },
          ]}
        />
        <Select
          aria-label="Filter by ingestion status"
          value={ingestionStatus}
          onChange={(event) => setIngestionStatus(event.target.value)}
          options={[
            { value: ALL_VALUE, label: "All Ingestion Statuses" },
            { value: NEVER_INGESTED_VALUE, label: "Never ingested" },
            { value: "COMPLETED", label: "Completed" },
            { value: "FAILED", label: "Failed" },
            { value: "SKIPPED_DUPLICATE", label: "Skipped (duplicate)" },
            { value: "CREATED", label: "Created" },
            { value: "READING_SOURCE", label: "Reading source" },
            { value: "WRITING_BRONZE", label: "Writing Bronze" },
          ]}
        />
        <Select
          aria-label="Filter by data product"
          value={dataProductId}
          onChange={(event) => setDataProductId(event.target.value)}
          options={dataProductOptions}
        />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <Select
          aria-label="Filter by org / tenant"
          value={orgTenant}
          onChange={(event) => setOrgTenant(event.target.value)}
          options={orgTenantOptions}
        />
        <Input
          type="date"
          label="Created from"
          aria-label="Filter by created-at start date"
          value={dateFrom}
          max={dateTo || undefined}
          onChange={(event) => setDateFrom(event.target.value)}
        />
        <Input
          type="date"
          label="Created to"
          aria-label="Filter by created-at end date"
          value={dateTo}
          min={dateFrom || undefined}
          onChange={(event) => setDateTo(event.target.value)}
        />
        {dateFrom || dateTo ? (
          <div className="flex items-end">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => {
                setDateFrom("");
                setDateTo("");
              }}
            >
              Clear dates
            </Button>
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex items-end gap-2">
          <Select
            label="Sort by"
            aria-label="Sort by"
            value={sortColumn}
            onChange={(event) => handleSort(event.target.value as SortColumn)}
            options={sortOptions}
          />
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"))}
            aria-label={`Sort ${sortDirection === "asc" ? "ascending" : "descending"}`}
          >
            {sortDirection === "asc" ? "▲ Asc" : "▼ Desc"}
          </Button>
        </div>
        {filtered.length > 0 ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() =>
              setExpandedIds(allExpanded ? new Set() : new Set(filtered.map((row) => row.exchangeId)))
            }
          >
            {allExpanded ? "Collapse all" : "Expand all"}
          </Button>
        ) : null}
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          title="No exchanges match your filters"
          description="Try adjusting your search or filter criteria."
        />
      ) : (
        <Table>
          <TableHead>
            <TableRow>
              <TableHeaderCell className={COMPACT_CELL} aria-hidden />
              <TableHeaderCell className={COMPACT_CELL}>Exchange</TableHeaderCell>
              <TableHeaderCell className={COMPACT_CELL}>Status</TableHeaderCell>
              <TableHeaderCell className={COMPACT_CELL}>Ingestion Status</TableHeaderCell>
              <TableHeaderCell className={COMPACT_CELL}>Created</TableHeaderCell>
              <TableHeaderCell className={`${STICKY_ACTIONS_CELL} ${COMPACT_CELL} bg-slate-50`}>
                Actions
              </TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {filtered.map((row) => {
              const expanded = expandedIds.has(row.exchangeId);
              return (
                <Fragment key={row.exchangeId}>
                  <TableRow>
                    <TableCell className={COMPACT_CELL}>
                      <button
                        type="button"
                        onClick={() => toggleExpanded(row.exchangeId)}
                        aria-expanded={expanded}
                        aria-label={expanded ? "Collapse row details" : "Expand row details"}
                        className="flex h-6 w-6 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                      >
                        {expanded ? "▾" : "▸"}
                      </button>
                    </TableCell>
                    <TableCell className={COMPACT_CELL}>
                      <div className="font-medium text-slate-900">
                        {row.filename ?? <span className="italic text-slate-400">(no filename)</span>}
                      </div>
                      <div className="font-mono text-xs text-slate-500">{row.exchangeId}</div>
                    </TableCell>
                    <TableCell className={COMPACT_CELL}>
                      <div className="mb-1 text-xs text-slate-500">{row.direction}</div>
                      <StatusBadge status={row.exchangeStatus} />
                    </TableCell>
                    <TableCell className={COMPACT_CELL}>
                      {row.ingestion ? (
                        <StatusBadge status={row.ingestion.status} />
                      ) : (
                        <span className="text-xs text-slate-500">Never ingested</span>
                      )}
                      {row.ingestion?.errorMessage ? (
                        <p className="mt-1 max-w-xs truncate text-xs text-red-600">
                          {row.ingestion.errorMessage}
                        </p>
                      ) : null}
                    </TableCell>
                    <TableCell className={`${COMPACT_CELL} text-xs text-slate-500`}>
                      {new Date(row.createdAt).toLocaleString()}
                    </TableCell>
                    <TableCell className={`${STICKY_ACTIONS_CELL} ${COMPACT_CELL} bg-white`}>
                      <div className="flex flex-col gap-2">
                        {row.direction === "INBOUND" ? (
                          <form action={triggerIngestionAction.bind(null, row.exchangeId)}>
                            <Button type="submit" size="sm" variant="secondary">
                              Run ingestion
                            </Button>
                          </form>
                        ) : null}
                        {row.ingestion?.status === "COMPLETED" ? (
                          <form action={triggerBronzeToSilverAction}>
                            <input type="hidden" name="ingestionId" value={row.ingestion.ingestionId} />
                            <Button type="submit" size="sm" variant="secondary">
                              Run Bronze→Silver
                            </Button>
                          </form>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                  {expanded ? (
                    <TableRow className="hover:bg-transparent">
                      <TableCell />
                      <TableCell colSpan={5} className="bg-slate-50 py-3">
                        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs sm:grid-cols-4">
                          <div>
                            <dt className="font-semibold uppercase tracking-wide text-slate-500">
                              Org / Tenant
                            </dt>
                            <dd className="font-mono text-slate-700">
                              {row.organizationId}
                              <br />
                              {row.tenantId}
                            </dd>
                          </div>
                          <div>
                            <dt className="font-semibold uppercase tracking-wide text-slate-500">
                              Data Product
                            </dt>
                            <dd className="text-slate-700">{row.dataProductId}</dd>
                          </div>
                          <div>
                            <dt className="font-semibold uppercase tracking-wide text-slate-500">
                              Bronze Table
                            </dt>
                            <dd className="font-mono text-slate-700">{row.ingestion?.bronzeTable ?? "—"}</dd>
                          </div>
                          <div>
                            <dt className="font-semibold uppercase tracking-wide text-slate-500">Records</dt>
                            <dd className="text-slate-700">
                              {row.ingestion
                                ? `${row.ingestion.bronzeRecordCount} / ${row.ingestion.sourceRecordCount}` +
                                  (row.ingestion.rejectedRecordCount
                                    ? ` (${row.ingestion.rejectedRecordCount} rejected)`
                                    : "")
                                : "—"}
                            </dd>
                          </div>
                          <div>
                            <dt className="font-semibold uppercase tracking-wide text-slate-500">
                              Ingestion ID
                            </dt>
                            <dd className="font-mono text-slate-700">{row.ingestion?.ingestionId ?? "—"}</dd>
                          </div>
                          {row.ingestion?.errorMessage ? (
                            <div className="col-span-2 sm:col-span-4">
                              <dt className="font-semibold uppercase tracking-wide text-slate-500">
                                Error
                              </dt>
                              <dd className="text-red-600">{row.ingestion.errorMessage}</dd>
                            </div>
                          ) : null}
                        </dl>
                      </TableCell>
                    </TableRow>
                  ) : null}
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
