import Link from "next/link";
import type { ExchangeDirection, ExchangeStatus } from "@/models";
import {
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

export interface RecentExchangeRow {
  id: string;
  datasetName: string;
  direction: ExchangeDirection;
  receivedAt: string;
  status: ExchangeStatus;
  recordCount: number;
}

export function RecentExchangesTable({ rows }: { rows: RecentExchangeRow[] }) {
  if (rows.length === 0) {
    return <EmptyState title="No exchanges yet" description="Inbound and outbound exchanges will appear here." />;
  }

  return (
    <Table>
      <TableHead>
        <TableRow>
          <TableHeaderCell>Exchange ID</TableHeaderCell>
          <TableHeaderCell>Dataset</TableHeaderCell>
          <TableHeaderCell>Direction</TableHeaderCell>
          <TableHeaderCell>Started</TableHeaderCell>
          <TableHeaderCell>Status</TableHeaderCell>
          <TableHeaderCell>Records</TableHeaderCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.id}>
            <TableCell>
              <Link href={`/exchanges/${row.id}`} className="font-medium text-slate-900 hover:underline">
                {row.id}
              </Link>
            </TableCell>
            <TableCell>{row.datasetName}</TableCell>
            <TableCell>{row.direction}</TableCell>
            <TableCell>{formatDateTime(row.receivedAt)}</TableCell>
            <TableCell>
              <StatusBadge status={row.status} />
            </TableCell>
            <TableCell>{formatNumber(row.recordCount)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
