"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
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
import type { PipelineRunRow } from "@/services/interfaces";

const ALL_VALUE = "ALL";

export function PipelineRunsTable({ items }: { items: PipelineRunRow[] }) {
  const [search, setSearch] = useState("");
  const [pipelineType, setPipelineType] = useState(ALL_VALUE);
  const [status, setStatus] = useState(ALL_VALUE);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return items.filter((row) => {
      const matchesSearch =
        !query ||
        row.pipelineRunId.toLowerCase().includes(query) ||
        row.pipelineName.toLowerCase().includes(query) ||
        (row.sourceIngestionId?.toLowerCase().includes(query) ?? false) ||
        (row.dataProductId?.toLowerCase().includes(query) ?? false);
      const matchesType = pipelineType === ALL_VALUE || row.pipelineType === pipelineType;
      const matchesStatus = status === ALL_VALUE || row.status === status;
      return matchesSearch && matchesType && matchesStatus;
    });
  }, [items, search, pipelineType, status]);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Input
          aria-label="Search by pipeline run, name, ingestion, or data product"
          placeholder="Search pipeline run, ingestion, data product…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <Select
          aria-label="Filter by pipeline type"
          value={pipelineType}
          onChange={(event) => setPipelineType(event.target.value)}
          options={[
            { value: ALL_VALUE, label: "All Types" },
            { value: "BRONZE_TO_SILVER", label: "Bronze → Silver" },
            { value: "SILVER_TO_GOLD", label: "Silver → Gold" },
          ]}
        />
        <Select
          aria-label="Filter by status"
          value={status}
          onChange={(event) => setStatus(event.target.value)}
          options={[
            { value: ALL_VALUE, label: "All Statuses" },
            { value: "COMPLETED", label: "Completed" },
            { value: "FAILED", label: "Failed" },
            { value: "SKIPPED_DUPLICATE", label: "Skipped (duplicate)" },
            { value: "CREATED", label: "Created" },
            { value: "READING_SOURCE", label: "Reading source" },
            { value: "VALIDATING", label: "Validating" },
            { value: "TRANSFORMING", label: "Transforming" },
            { value: "QUALITY_CHECK", label: "Quality check" },
            { value: "WRITING", label: "Writing" },
          ]}
        />
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          title="No pipeline runs match your filters"
          description="Trigger a Bronze → Silver or Silver → Gold run above, or adjust your filters."
        />
      ) : (
        <Table>
          <TableHead>
            <TableRow>
              <TableHeaderCell>Pipeline Run</TableHeaderCell>
              <TableHeaderCell>Type</TableHeaderCell>
              <TableHeaderCell>Org / Tenant</TableHeaderCell>
              <TableHeaderCell>Source → Target</TableHeaderCell>
              <TableHeaderCell>Status</TableHeaderCell>
              <TableHeaderCell>Records</TableHeaderCell>
              <TableHeaderCell>Started</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {filtered.map((row) => (
              <TableRow key={row.pipelineRunId}>
                <TableCell>
                  <Link
                    href={`/admin/lakehouse/pipelines/${row.pipelineRunId}`}
                    className="font-mono text-xs text-slate-900 underline underline-offset-2 hover:text-slate-600"
                  >
                    {row.pipelineRunId}
                  </Link>
                  <div className="text-xs text-slate-500">{row.pipelineName}</div>
                </TableCell>
                <TableCell className="text-xs">
                  {row.pipelineType === "BRONZE_TO_SILVER" ? "Bronze → Silver" : "Silver → Gold"}
                </TableCell>
                <TableCell className="font-mono text-xs text-slate-500">
                  {row.organizationId}
                  <br />
                  {row.tenantId}
                </TableCell>
                <TableCell className="font-mono text-xs">
                  {row.sourceTable}
                  <br />
                  <span className="text-slate-400">→</span> {row.targetTable}
                </TableCell>
                <TableCell>
                  <StatusBadge status={row.status} />
                  {row.errorMessage ? (
                    <p className="mt-1 max-w-xs text-xs text-red-600">{row.errorMessage}</p>
                  ) : null}
                </TableCell>
                <TableCell className="text-xs">
                  {row.outputRecordCount ?? "—"} / {row.inputRecordCount ?? "—"}
                  {row.rejectedRecordCount ? ` (${row.rejectedRecordCount} rejected)` : ""}
                </TableCell>
                <TableCell className="text-xs text-slate-500">
                  {new Date(row.startedAt).toLocaleString()}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
