import { AlertTriangle } from "lucide-react";
import { ExchangeStatus, type Dataset, type Exchange } from "@/models";
import { Card, CardHeader, CardTitle, CardContent, Badge } from "@/components/ui";
import { formatBytes, formatDateTime, formatNumber } from "@/lib/utils";
import { ExchangeTimeline } from "./exchange-timeline";

export function ExchangeDetail({ exchange, dataset }: { exchange: Exchange; dataset: Dataset | null }) {
  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Exchange Details</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-3 lg:grid-cols-4">
            <Field label="Exchange ID" value={exchange.id} mono />
            <Field label="Correlation ID" value={exchange.correlationId} mono />
            <Field label="Dataset" value={dataset?.displayName ?? exchange.datasetId} />
            <Field label="Direction" value={exchange.direction} />
            <Field label="Filename" value={exchange.filename} mono />
            <Field label="File Size" value={formatBytes(exchange.fileSize)} />
            <Field label="Schema Version" value={exchange.schemaVersion} />
            <Field label="Record Count" value={formatNumber(exchange.recordCount)} />
            <Field label="Started" value={formatDateTime(exchange.receivedAt)} />
            <Field
              label="Completed"
              value={exchange.completedAt ? formatDateTime(exchange.completedAt) : "—"}
            />
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Processing Timeline</CardTitle>
        </CardHeader>
        <CardContent>
          <ExchangeTimeline exchange={exchange} />
        </CardContent>
      </Card>

      {exchange.status === ExchangeStatus.FAILED && exchange.validationErrors.length > 0 ? (
        <Card className="border-red-200">
          <CardHeader className="border-red-100">
            <CardTitle className="flex items-center gap-2 text-red-700">
              <AlertTriangle className="h-4 w-4" aria-hidden="true" />
              Validation Errors
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-2">
              {exchange.validationErrors.map((error, index) => (
                <li key={index} className="flex items-start gap-2 text-sm text-red-700">
                  <Badge color="red">{error.field}</Badge>
                  <span>{error.message}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function Field({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className={mono ? "mt-0.5 font-mono text-xs text-slate-800" : "mt-0.5 font-medium text-slate-900"}>
        {value}
      </dd>
    </div>
  );
}
