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
import type { PipelineJobRow } from "@/services/interfaces";
import { runPipelineJobAction } from "../actions";

const ALL_VALUE = "ALL";

// Sticky so the action button stays reachable without scrolling the table
// horizontally, same precedent as ingestion-table.tsx's STICKY_ACTIONS_CELL.
const STICKY_ACTIONS_CELL = "sticky right-0 border-l border-slate-200";
const COMPACT_CELL = "!py-2";

type SortColumn = "createdAt" | "updatedAt" | "jobId";
type SortDirection = "asc" | "desc";

// PENDING: hasn't been picked up by the worker's poll loop yet -- "Run now"
// skips the wait. FAILED/SUCCEEDED: terminal -- "Re-enqueue" resets and
// reruns the whole chain. RUNNING: already in flight, no action offered.
function actionLabel(status: PipelineJobRow["status"]): string | null {
  if (status === "PENDING") return "Run now";
  if (status === "FAILED" || status === "SUCCEEDED") return "Re-enqueue & run";
  return null;
}

export function QueueTable({ items }: { items: PipelineJobRow[] }) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState(ALL_VALUE);
  const [dataProductId, setDataProductId] = useState(ALL_VALUE);
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

  const handleSort = (column: SortColumn) => {
    if (column === sortColumn) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortColumn(column);
      setSortDirection("asc");
    }
  };

  const toggleExpanded = (jobId: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(jobId)) {
        next.delete(jobId);
      } else {
        next.add(jobId);
      }
      return next;
    });
  };

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();

    const rows = items.filter((row) => {
      const matchesSearch =
        !query ||
        row.jobId.toLowerCase().includes(query) ||
        row.dataProductId.toLowerCase().includes(query) ||
        row.sourceExchangeId.toLowerCase().includes(query) ||
        (row.outboundExchangeId?.toLowerCase().includes(query) ?? false);
      const matchesStatus = status === ALL_VALUE || row.status === status;
      const matchesDataProduct = dataProductId === ALL_VALUE || row.dataProductId === dataProductId;
      return matchesSearch && matchesStatus && matchesDataProduct;
    });

    const sorted = [...rows].sort((a, b) => {
      let comparison = 0;
      if (sortColumn === "createdAt" || sortColumn === "updatedAt") {
        comparison = new Date(a[sortColumn]).getTime() - new Date(b[sortColumn]).getTime();
      } else {
        comparison = a[sortColumn].localeCompare(b[sortColumn]);
      }
      return sortDirection === "asc" ? comparison : -comparison;
    });

    return sorted;
  }, [items, search, status, dataProductId, sortColumn, sortDirection]);

  const allExpanded = filtered.length > 0 && filtered.every((row) => expandedIds.has(row.jobId));

  const sortOptions: { value: SortColumn; label: string }[] = [
    { value: "createdAt", label: "Created" },
    { value: "updatedAt", label: "Updated" },
    { value: "jobId", label: "Job ID" },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Input
          aria-label="Search by job ID, data product, or exchange ID"
          placeholder="Search job ID, data product, or exchange ID…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <Select
          aria-label="Filter by status"
          value={status}
          onChange={(event) => setStatus(event.target.value)}
          options={[
            { value: ALL_VALUE, label: "All Statuses" },
            { value: "PENDING", label: "Pending" },
            { value: "RUNNING", label: "Running" },
            { value: "SUCCEEDED", label: "Succeeded" },
            { value: "FAILED", label: "Failed" },
          ]}
        />
        <Select
          aria-label="Filter by data product"
          value={dataProductId}
          onChange={(event) => setDataProductId(event.target.value)}
          options={dataProductOptions}
        />
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
              setExpandedIds(allExpanded ? new Set() : new Set(filtered.map((row) => row.jobId)))
            }
          >
            {allExpanded ? "Collapse all" : "Expand all"}
          </Button>
        ) : null}
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          title="No pipeline jobs match your filters"
          description="Try adjusting your search or filter criteria."
        />
      ) : (
        <Table>
          <TableHead>
            <TableRow>
              <TableHeaderCell className={COMPACT_CELL} aria-hidden />
              <TableHeaderCell className={COMPACT_CELL}>Job</TableHeaderCell>
              <TableHeaderCell className={COMPACT_CELL}>Status</TableHeaderCell>
              <TableHeaderCell className={COMPACT_CELL}>Data Product</TableHeaderCell>
              <TableHeaderCell className={COMPACT_CELL}>Created</TableHeaderCell>
              <TableHeaderCell className={COMPACT_CELL}>Updated</TableHeaderCell>
              <TableHeaderCell className={`${STICKY_ACTIONS_CELL} ${COMPACT_CELL} bg-slate-50`}>
                Actions
              </TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {filtered.map((row) => {
              const expanded = expandedIds.has(row.jobId);
              const label = actionLabel(row.status);
              return (
                <Fragment key={row.jobId}>
                  <TableRow>
                    <TableCell className={COMPACT_CELL}>
                      <button
                        type="button"
                        onClick={() => toggleExpanded(row.jobId)}
                        aria-expanded={expanded}
                        aria-label={expanded ? "Collapse row details" : "Expand row details"}
                        className="flex h-6 w-6 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                      >
                        {expanded ? "▾" : "▸"}
                      </button>
                    </TableCell>
                    <TableCell className={COMPACT_CELL}>
                      <div className="font-mono text-xs text-slate-900">{row.jobId}</div>
                      <div className="font-mono text-xs text-slate-500">from {row.sourceExchangeId}</div>
                    </TableCell>
                    <TableCell className={COMPACT_CELL}>
                      <StatusBadge status={row.status} />
                      {row.currentStage ? (
                        <div className="mt-1 text-xs text-slate-500">{row.currentStage}</div>
                      ) : null}
                      {row.errorMessage ? (
                        <p className="mt-1 max-w-xs truncate text-xs text-red-600">{row.errorMessage}</p>
                      ) : null}
                    </TableCell>
                    <TableCell className={`${COMPACT_CELL} text-slate-700`}>{row.dataProductId}</TableCell>
                    <TableCell className={`${COMPACT_CELL} text-xs text-slate-500`}>
                      {new Date(row.createdAt).toLocaleString()}
                    </TableCell>
                    <TableCell className={`${COMPACT_CELL} text-xs text-slate-500`}>
                      {new Date(row.updatedAt).toLocaleString()}
                    </TableCell>
                    <TableCell className={`${STICKY_ACTIONS_CELL} ${COMPACT_CELL} bg-white`}>
                      {label ? (
                        <form action={runPipelineJobAction.bind(null, row.jobId)}>
                          <Button type="submit" size="sm" variant="secondary">
                            {label}
                          </Button>
                        </form>
                      ) : (
                        <span className="text-xs text-slate-400">In progress…</span>
                      )}
                    </TableCell>
                  </TableRow>
                  {expanded ? (
                    <TableRow className="hover:bg-transparent">
                      <TableCell />
                      <TableCell colSpan={6} className="bg-slate-50 py-3">
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
                            <dt className="font-semibold uppercase tracking-wide text-slate-500">Attempts</dt>
                            <dd className="text-slate-700">{row.attempts}</dd>
                          </div>
                          <div>
                            <dt className="font-semibold uppercase tracking-wide text-slate-500">
                              Outbound Exchange
                            </dt>
                            <dd className="font-mono text-slate-700">{row.outboundExchangeId ?? "—"}</dd>
                          </div>
                          <div>
                            <dt className="font-semibold uppercase tracking-wide text-slate-500">
                              Started / Completed
                            </dt>
                            <dd className="text-slate-700">
                              {row.startedAt ? new Date(row.startedAt).toLocaleString() : "—"}
                              {" / "}
                              {row.completedAt ? new Date(row.completedAt).toLocaleString() : "—"}
                            </dd>
                          </div>
                          {row.errorCode || row.errorMessage ? (
                            <div className="col-span-2 sm:col-span-4">
                              <dt className="font-semibold uppercase tracking-wide text-slate-500">Error</dt>
                              <dd className="text-red-600">
                                {row.errorCode ? `${row.errorCode}: ` : ""}
                                {row.errorMessage}
                              </dd>
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
