import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSuperuserContext } from "@/lib/admin";
import { services } from "@/services";
import {
  PageHeader,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  StatusBadge,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableHeaderCell,
  TableCell,
} from "@/components/ui";
import { LakehouseSubNav } from "../../lakehouse-sub-nav";

export default async function PipelineRunDetailPage({
  params,
}: {
  params: Promise<{ pipelineRunId: string }>;
}) {
  await requireSuperuserContext();
  const { pipelineRunId } = await params;
  const detail = await services.lakehouseAdmin.getPipelineRunDetail(pipelineRunId);
  if (!detail) notFound();

  const { run, qualityResults, lineageEdges } = detail;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Pipeline Run" description={pipelineRunId} />
      <LakehouseSubNav active="/admin/lakehouse/pipelines" />

      <Card>
        <CardHeader>
          <CardTitle>Run Summary</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <Field label="Pipeline">{run.pipelineName}</Field>
          <Field label="Type">
            {run.pipelineType === "BRONZE_TO_SILVER" ? "Bronze → Silver" : "Silver → Gold"}
          </Field>
          <Field label="Status">
            <StatusBadge status={run.status} />
          </Field>
          <Field label="Organization">{run.organizationId}</Field>
          <Field label="Tenant">{run.tenantId}</Field>
          <Field label="Data Product">{run.dataProductId ?? "—"}</Field>
          <Field label="Source Table">{run.sourceTable}</Field>
          <Field label="Target Table">{run.targetTable}</Field>
          <Field label="Source Ingestion">{run.sourceIngestionId ?? "—"}</Field>
          <Field label="Source Pipeline Run">
            {run.sourcePipelineRunId ? (
              <Link
                href={`/admin/lakehouse/pipelines/${run.sourcePipelineRunId}`}
                className="underline underline-offset-2"
              >
                {run.sourcePipelineRunId}
              </Link>
            ) : (
              "—"
            )}
          </Field>
          <Field label="Input / Output / Rejected">
            {run.inputRecordCount ?? "—"} / {run.outputRecordCount ?? "—"} / {run.rejectedRecordCount ?? 0}
          </Field>
          <Field label="Started">{new Date(run.startedAt).toLocaleString()}</Field>
          <Field label="Completed">
            {run.completedAt ? new Date(run.completedAt).toLocaleString() : "—"}
          </Field>
          {run.errorMessage ? (
            <Field label="Error">
              <span className="text-red-600">
                {run.errorCode}: {run.errorMessage}
              </span>
            </Field>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Quality Results</CardTitle>
        </CardHeader>
        <CardContent>
          {qualityResults.length === 0 ? (
            <p className="text-sm text-slate-500">No quality rules evaluated for this run.</p>
          ) : (
            <Table>
              <TableHead>
                <TableRow>
                  <TableHeaderCell>Rule</TableHeaderCell>
                  <TableHeaderCell>Severity</TableHeaderCell>
                  <TableHeaderCell>Passed</TableHeaderCell>
                  <TableHeaderCell>Failed / Total</TableHeaderCell>
                  <TableHeaderCell>Failure %</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {qualityResults.map((r) => (
                  <TableRow key={r.ruleName}>
                    <TableCell className="font-mono text-xs">{r.ruleName}</TableCell>
                    <TableCell>
                      <StatusBadge status={r.severity} />
                    </TableCell>
                    <TableCell>{r.passed ? "✓" : "✗"}</TableCell>
                    <TableCell className="text-xs">
                      {r.failedCount} / {r.totalCount}
                    </TableCell>
                    <TableCell className="text-xs">{r.failurePercentage.toFixed(1)}%</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Lineage (this run&apos;s edges)</CardTitle>
        </CardHeader>
        <CardContent>
          {lineageEdges.length === 0 ? (
            <p className="text-sm text-slate-500">No lineage edges recorded for this run.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {lineageEdges.map((edge) => (
                <li
                  key={`${edge.sourceType}:${edge.sourceIdentifier}`}
                  className="font-mono text-xs text-slate-600"
                >
                  <span className="text-slate-400">{edge.sourceType}</span> {edge.sourceIdentifier}{" "}
                  <span className="text-slate-400">→ {edge.targetType}</span> {edge.targetIdentifier}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-0.5 font-mono text-xs text-slate-900">{children}</div>
    </div>
  );
}
