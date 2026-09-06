"use client";

import { useMemo, useState } from "react";
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

// Sticky so "Run ingestion" stays reachable without scrolling the table
// horizontally — every other column can grow (org/tenant ids, bronze
// table names, ...) without pushing the action off-screen.
const STICKY_ACTIONS_CELL = "sticky right-0 border-l border-slate-200";

export function IngestionTable({ items }: { items: AdminExchangeIngestionRow[] }) {
  const [search, setSearch] = useState("");
  const [direction, setDirection] = useState(ALL_VALUE);
  const [ingestionStatus, setIngestionStatus] = useState(ALL_VALUE);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return items.filter((row) => {
      const matchesSearch =
        !query ||
        row.exchangeId.toLowerCase().includes(query) ||
        row.dataProductId.toLowerCase().includes(query) ||
        (row.filename?.toLowerCase().includes(query) ?? false);
      const matchesDirection = direction === ALL_VALUE || row.direction === direction;
      const rowIngestionStatus = row.ingestion?.status ?? NEVER_INGESTED_VALUE;
      const matchesIngestion = ingestionStatus === ALL_VALUE || rowIngestionStatus === ingestionStatus;
      return matchesSearch && matchesDirection && matchesIngestion;
    });
  }, [items, search, direction, ingestionStatus]);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
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
              <TableHeaderCell>Exchange</TableHeaderCell>
              <TableHeaderCell>Org / Tenant</TableHeaderCell>
              <TableHeaderCell>Status</TableHeaderCell>
              <TableHeaderCell>Data Product</TableHeaderCell>
              <TableHeaderCell>Ingestion Status</TableHeaderCell>
              <TableHeaderCell>Bronze Table</TableHeaderCell>
              <TableHeaderCell>Records</TableHeaderCell>
              <TableHeaderCell className={`${STICKY_ACTIONS_CELL} bg-slate-50`}>Actions</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {filtered.map((row) => (
              <TableRow key={row.exchangeId}>
                <TableCell>
                  <div className="font-medium text-slate-900">
                    {row.filename ?? <span className="italic text-slate-400">(no filename)</span>}
                  </div>
                  <div className="font-mono text-xs text-slate-500">{row.exchangeId}</div>
                </TableCell>
                <TableCell className="font-mono text-xs text-slate-500">
                  {row.organizationId}
                  <br />
                  {row.tenantId}
                </TableCell>
                <TableCell>
                  <div className="mb-1 text-xs text-slate-500">{row.direction}</div>
                  <StatusBadge status={row.exchangeStatus} />
                </TableCell>
                <TableCell>{row.dataProductId}</TableCell>
                <TableCell>
                  {row.ingestion ? (
                    <StatusBadge status={row.ingestion.status} />
                  ) : (
                    <span className="text-xs text-slate-500">Never ingested</span>
                  )}
                  {row.ingestion?.errorMessage ? (
                    <p className="mt-1 max-w-xs text-xs text-red-600">{row.ingestion.errorMessage}</p>
                  ) : null}
                </TableCell>
                <TableCell className="font-mono text-xs">{row.ingestion?.bronzeTable ?? "—"}</TableCell>
                <TableCell className="text-xs">
                  {row.ingestion
                    ? `${row.ingestion.bronzeRecordCount} / ${row.ingestion.sourceRecordCount}` +
                      (row.ingestion.rejectedRecordCount
                        ? ` (${row.ingestion.rejectedRecordCount} rejected)`
                        : "")
                    : "—"}
                </TableCell>
                <TableCell className={`${STICKY_ACTIONS_CELL} bg-white`}>
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
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
