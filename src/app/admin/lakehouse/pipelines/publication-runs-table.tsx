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
} from "@/components/ui";
import type { PublicationRunRow } from "@/services/interfaces";

const ALL_VALUE = "ALL";

export function PublicationRunsTable({ items }: { items: PublicationRunRow[] }) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState(ALL_VALUE);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return items.filter((row) => {
      const matchesSearch =
        !query ||
        row.publicationId.toLowerCase().includes(query) ||
        row.dataProductId.toLowerCase().includes(query) ||
        (row.sourcePipelineRunId?.toLowerCase().includes(query) ?? false) ||
        (row.outboundExchangeId?.toLowerCase().includes(query) ?? false);
      const matchesStatus = status === ALL_VALUE || row.status === status;
      return matchesSearch && matchesStatus;
    });
  }, [items, search, status]);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Input
          aria-label="Search by publication, data product, pipeline run, or exchange"
          placeholder="Search publication, data product, exchange…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <Select
          aria-label="Filter by status"
          value={status}
          onChange={(event) => setStatus(event.target.value)}
          options={[
            { value: ALL_VALUE, label: "All Statuses" },
            { value: "READY", label: "Ready" },
            { value: "FAILED", label: "Failed" },
            { value: "SKIPPED_DUPLICATE", label: "Skipped (duplicate)" },
            { value: "CREATED", label: "Created" },
            { value: "READING_GOLD", label: "Reading Gold" },
            { value: "QUALITY_CHECK", label: "Quality check" },
            { value: "EXPORTING", label: "Exporting" },
            { value: "CREATING_OUTBOUND_EXCHANGE", label: "Creating outbound exchange" },
            { value: "TRANSFERRING", label: "Transferring" },
          ]}
        />
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          title="No publications match your filters"
          description="Publish a completed Gold pipeline run above, or adjust your filters."
        />
      ) : (
        <Table>
          <TableHead>
            <TableRow>
              <TableHeaderCell>Publication</TableHeaderCell>
              <TableHeaderCell>Data Product</TableHeaderCell>
              <TableHeaderCell>Org / Tenant</TableHeaderCell>
              <TableHeaderCell>Gold Snapshot</TableHeaderCell>
              <TableHeaderCell>Status</TableHeaderCell>
              <TableHeaderCell>Records</TableHeaderCell>
              <TableHeaderCell>Outbound Exchange</TableHeaderCell>
              <TableHeaderCell>Created</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {filtered.map((row) => (
              <TableRow key={row.publicationId}>
                <TableCell>
                  <span className="font-mono text-xs text-slate-900">{row.publicationId}</span>
                  <div className="text-xs text-slate-500">from {row.sourcePipelineRunId ?? "—"}</div>
                </TableCell>
                <TableCell className="text-xs">
                  {row.dataProductId}
                  <div className="text-slate-400">v{row.productVersion}</div>
                </TableCell>
                <TableCell className="font-mono text-xs text-slate-500">
                  {row.organizationId}
                  <br />
                  {row.tenantId}
                </TableCell>
                <TableCell className="font-mono text-xs text-slate-500">
                  {row.sourceGoldSnapshotId ?? "—"}
                </TableCell>
                <TableCell>
                  <StatusBadge status={row.status} />
                  {row.errorMessage ? (
                    <p className="mt-1 max-w-xs text-xs text-red-600">{row.errorMessage}</p>
                  ) : null}
                </TableCell>
                <TableCell className="text-xs">
                  {row.outputRecordCount ?? "—"} / {row.inputRecordCount ?? "—"}
                </TableCell>
                <TableCell className="font-mono text-xs text-slate-500">
                  {row.outboundExchangeId ?? "—"}
                </TableCell>
                <TableCell className="text-xs text-slate-500">
                  {new Date(row.createdAt).toLocaleString()}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
