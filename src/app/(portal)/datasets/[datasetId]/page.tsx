import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireTenantContext } from "@/lib/tenant";
import { services } from "@/services";
import { PageHeader, StatusBadge } from "@/components/ui";
import { DatasetDetail } from "@/components/datasets/dataset-detail";

interface DatasetDetailPageProps {
  params: Promise<{ datasetId: string }>;
}

export default async function DatasetDetailPage({ params }: DatasetDetailPageProps) {
  const { datasetId } = await params;
  const tenant = await requireTenantContext();
  const dataset = await services.datasets.getDataset(tenant.tenantId, datasetId);

  if (!dataset) {
    notFound();
  }

  const dataProductIds = await services.datasets.listDataProductIdsForDataset(datasetId);
  const dataProducts = (
    await Promise.all(dataProductIds.map((id) => services.dataProducts.getDataProduct(tenant.tenantId, id)))
  ).filter((dataProduct): dataProduct is NonNullable<typeof dataProduct> => dataProduct !== null);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href="/datasets"
          className="mb-3 inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-900"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to Data Products
        </Link>
        <PageHeader
          title={dataset.displayName}
          description={`${dataset.domain} · Format: ${dataset.format}`}
          actions={<StatusBadge status={dataset.status} />}
        />
      </div>
      <DatasetDetail dataset={dataset} dataProducts={dataProducts} />
    </div>
  );
}
