"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ExchangeDirection, ExchangeStatus, type Dataset, type Exchange } from "@/models";
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
import { formatDateTime, formatNumber } from "@/lib/utils";

const ALL_VALUE = "ALL";

export function ExchangeExplorer({
  exchanges,
  datasets,
}: {
  exchanges: Exchange[];
  datasets: Dataset[];
}) {
  const [direction, setDirection] = useState(ALL_VALUE);
  const [status, setStatus] = useState(ALL_VALUE);
  const [datasetId, setDatasetId] = useState(ALL_VALUE);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const datasetNameById = useMemo(
    () => new Map(datasets.map((dataset) => [dataset.id, dataset.displayName])),
    [datasets],
  );

  const filtered = useMemo(() => {
    return exchanges.filter((exchange) => {
      const matchesDirection = direction === ALL_VALUE || exchange.direction === direction;
      const matchesStatus = status === ALL_VALUE || exchange.status === status;
      const matchesDataset = datasetId === ALL_VALUE || exchange.datasetId === datasetId;
      const receivedTime = new Date(exchange.receivedAt).getTime();
      const matchesStart = !startDate || receivedTime >= new Date(startDate).getTime();
      const matchesEnd = !endDate || receivedTime <= new Date(endDate).getTime() + 86_400_000 - 1;
      return matchesDirection && matchesStatus && matchesDataset && matchesStart && matchesEnd;
    });
  }, [exchanges, direction, status, datasetId, startDate, endDate]);

  const sorted = useMemo(
    () => [...filtered].sort((a, b) => new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime()),
    [filtered],
  );

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Select
          aria-label="Filter by direction"
          value={direction}
          onChange={(event) => setDirection(event.target.value)}
          options={[
            { value: ALL_VALUE, label: "All Directions" },
            { value: ExchangeDirection.INBOUND, label: "Inbound" },
            { value: ExchangeDirection.OUTBOUND, label: "Outbound" },
          ]}
        />
        <Select
          aria-label="Filter by status"
          value={status}
          onChange={(event) => setStatus(event.target.value)}
          options={[
            { value: ALL_VALUE, label: "All Statuses" },
            { value: ExchangeStatus.RECEIVED, label: "Received" },
            { value: ExchangeStatus.VALIDATING, label: "Validating" },
            { value: ExchangeStatus.PROCESSING, label: "Processing" },
            { value: ExchangeStatus.COMPLETED, label: "Completed" },
            { value: ExchangeStatus.FAILED, label: "Failed" },
          ]}
        />
        <Select
          aria-label="Filter by dataset"
          value={datasetId}
          onChange={(event) => setDatasetId(event.target.value)}
          options={[
            { value: ALL_VALUE, label: "All Datasets" },
            ...datasets.map((dataset) => ({ value: dataset.id, label: dataset.displayName })),
          ]}
        />
        <Input
          aria-label="Start date"
          type="date"
          value={startDate}
          onChange={(event) => setStartDate(event.target.value)}
        />
        <Input
          aria-label="End date"
          type="date"
          value={endDate}
          onChange={(event) => setEndDate(event.target.value)}
        />
      </div>

      {sorted.length === 0 ? (
        <EmptyState
          title="No exchanges match your filters"
          description="Try adjusting your search or filter criteria."
        />
      ) : (
        <Table>
          <TableHead>
            <TableRow>
              <TableHeaderCell>Exchange ID</TableHeaderCell>
              <TableHeaderCell>Dataset</TableHeaderCell>
              <TableHeaderCell>Direction</TableHeaderCell>
              <TableHeaderCell>Filename</TableHeaderCell>
              <TableHeaderCell>Received</TableHeaderCell>
              <TableHeaderCell>Records</TableHeaderCell>
              <TableHeaderCell>Status</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {sorted.map((exchange) => (
              <TableRow key={exchange.id}>
                <TableCell>
                  <Link
                    href={`/exchanges/${exchange.id}`}
                    className="font-medium text-slate-900 hover:underline"
                  >
                    {exchange.id}
                  </Link>
                </TableCell>
                <TableCell>{datasetNameById.get(exchange.datasetId) ?? exchange.datasetId}</TableCell>
                <TableCell>{exchange.direction}</TableCell>
                <TableCell className="font-mono text-xs">{exchange.filename}</TableCell>
                <TableCell>{formatDateTime(exchange.receivedAt)}</TableCell>
                <TableCell>{formatNumber(exchange.recordCount)}</TableCell>
                <TableCell>
                  <StatusBadge status={exchange.status} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
