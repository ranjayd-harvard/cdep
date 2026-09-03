import Link from "next/link";
import type { Dataset } from "@/models";
import { Card, CardContent, Badge, StatusBadge } from "@/components/ui";
import { formatDate } from "@/lib/utils";

export function DatasetCard({ dataset }: { dataset: Dataset }) {
  return (
    <Link href={`/datasets/${dataset.id}`}>
      <Card className="h-full transition-shadow hover:shadow-md">
        <CardContent className="flex h-full flex-col gap-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-sm font-semibold text-slate-900">{dataset.displayName}</p>
              <p className="text-xs text-slate-500">{dataset.domain}</p>
            </div>
            <StatusBadge status={dataset.status} />
          </div>

          <p className="line-clamp-2 text-sm text-slate-600">{dataset.description}</p>

          <div className="flex flex-wrap gap-1.5">
            {dataset.accessMethods.map((method) => (
              <Badge key={method} color="blue">
                {method.replace("_", " ")}
              </Badge>
            ))}
          </div>

          <dl className="mt-auto grid grid-cols-2 gap-2 border-t border-slate-100 pt-3 text-xs text-slate-500">
            <div>
              <dt className="font-medium text-slate-400">Version</dt>
              <dd>{dataset.version}</dd>
            </div>
            <div>
              <dt className="font-medium text-slate-400">Freshness</dt>
              <dd>{dataset.freshness}</dd>
            </div>
            <div className="col-span-2">
              <dt className="font-medium text-slate-400">Last Updated</dt>
              <dd>{formatDate(dataset.lastUpdated)}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>
    </Link>
  );
}
