import type { ReactNode } from "react";
import type { DataProduct, Dataset } from "@/models";
import { Card, CardHeader, CardTitle, CardContent, Badge, StatusBadge } from "@/components/ui";
import { formatDate } from "@/lib/utils";

const ACCESS_METHOD_LABELS: Record<string, string> = {
  API: "API",
  DOWNLOAD: "Download",
  SFTP: "SFTP",
  DATA_SHARE: "Secure Data Share",
};

export function DatasetDetail({
  dataset,
  dataProducts,
}: {
  dataset: Dataset;
  dataProducts: DataProduct[];
}) {
  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Overview</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-4 text-sm text-slate-600">{dataset.description}</p>
          <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
            <Field
              label="Used By"
              value={
                dataProducts.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {dataProducts.map((dataProduct) => (
                      <Badge key={dataProduct.id} color="gray">
                        {dataProduct.displayName}
                      </Badge>
                    ))}
                  </div>
                ) : (
                  "—"
                )
              }
            />
            <Field label="Data Owner" value={dataset.owner} />
            <Field label="Domain" value={dataset.domain} />
            <Field label="Version" value={dataset.version} />
            <Field label="Status" value={<StatusBadge status={dataset.status} />} />
            <Field label="Last Updated" value={formatDate(dataset.lastUpdated)} />
            <Field label="Freshness SLA" value={dataset.freshness} />
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Row-Level Security</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
            <Field
              label="Tenant Column"
              value={<code className="font-mono text-xs">{dataset.rowLevelPolicy.tenantColumn}</code>}
            />
            <Field label="Policy" value={dataset.rowLevelPolicy.description} stacked />
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Access</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {(["API", "DOWNLOAD", "SFTP", "DATA_SHARE"] as const).map((method) => {
              const supported = dataset.accessMethods.includes(method);
              return (
                <Badge key={method} color={supported ? "blue" : "gray"}>
                  {ACCESS_METHOD_LABELS[method]} {supported ? "" : "(Not available)"}
                </Badge>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Schema</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th scope="col" className="px-4 py-2 text-left text-xs font-semibold uppercase text-slate-500">
                    Field
                  </th>
                  <th scope="col" className="px-4 py-2 text-left text-xs font-semibold uppercase text-slate-500">
                    Type
                  </th>
                  <th scope="col" className="px-4 py-2 text-left text-xs font-semibold uppercase text-slate-500">
                    Required
                  </th>
                  <th scope="col" className="px-4 py-2 text-left text-xs font-semibold uppercase text-slate-500">
                    Description
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {dataset.schema.map((field) => (
                  <tr key={field.field}>
                    <td className="px-4 py-2 font-mono text-xs text-slate-800">{field.field}</td>
                    <td className="px-4 py-2 text-slate-600">{field.type}</td>
                    <td className="px-4 py-2">
                      <Badge color={field.required ? "yellow" : "gray"}>
                        {field.required ? "Required" : "Optional"}
                      </Badge>
                    </td>
                    <td className="px-4 py-2 text-slate-600">{field.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Data Quality</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <QualityMetric label="Completeness" value={dataset.quality.completeness} />
            <QualityMetric label="Freshness" value={dataset.quality.freshness} />
            <QualityMetric label="Validity" value={dataset.quality.validity} />
            <QualityMetric label="Duplicates" value={dataset.quality.duplicates} invert />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Documentation</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="flex flex-col gap-4 text-sm">
            <Field label="Business Definition" value={dataset.documentation.businessDefinition} stacked />
            <Field label="Data Contract" value={dataset.documentation.dataContract} stacked />
            <Field label="SLA" value={dataset.documentation.sla} stacked />
            <div>
              <dt className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">
                Change History
              </dt>
              <dd>
                <ul className="flex flex-col gap-2 border-l-2 border-slate-100 pl-4">
                  {dataset.documentation.changeHistory.map((entry) => (
                    <li key={entry.version}>
                      <p className="text-sm font-medium text-slate-900">
                        v{entry.version} — {formatDate(entry.date)}
                      </p>
                      <p className="text-xs text-slate-500">{entry.summary}</p>
                    </li>
                  ))}
                </ul>
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}

function Field({
  label,
  value,
  stacked = false,
}: {
  label: string;
  value: ReactNode;
  stacked?: boolean;
}) {
  if (stacked) {
    return (
      <div>
        <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</dt>
        <dd className="mt-0.5 text-slate-700">{value}</dd>
      </div>
    );
  }
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="mt-0.5 font-medium text-slate-900">{value}</dd>
    </div>
  );
}

function QualityMetric({
  label,
  value,
  invert = false,
}: {
  label: string;
  value: number;
  invert?: boolean;
}) {
  const isGood = invert ? value < 1 : value >= 97;
  const isWarning = invert ? value >= 1 && value < 3 : value >= 90 && value < 97;
  const tone = isGood ? "text-emerald-600" : isWarning ? "text-amber-600" : "text-red-600";

  return (
    <div className="rounded-md border border-slate-200 p-3 text-center">
      <p className={`text-xl font-semibold ${tone}`}>{value.toFixed(1)}%</p>
      <p className="text-xs text-slate-500">{label}</p>
    </div>
  );
}
