import Link from "next/link";
import type { Dataset } from "@/models";
import { Card, CardContent, StatusBadge, EmptyState } from "@/components/ui";
import { formatDate } from "@/lib/utils";

export function DataProductsPreview({ datasets }: { datasets: Dataset[] }) {
  if (datasets.length === 0) {
    return <EmptyState title="No data products available" />;
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {datasets.map((dataset) => (
        <Link key={dataset.id} href={`/datasets/${dataset.id}`}>
          <Card className="h-full transition-shadow hover:shadow-md">
            <CardContent className="flex h-full flex-col gap-2">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-semibold text-slate-900">{dataset.displayName}</p>
                <StatusBadge status={dataset.status} />
              </div>
              <p className="line-clamp-2 text-xs text-slate-500">{dataset.description}</p>
              <p className="mt-auto text-xs text-slate-400">
                Updated {formatDate(dataset.lastUpdated)} · v{dataset.version}
              </p>
            </CardContent>
          </Card>
        </Link>
      ))}
    </div>
  );
}
