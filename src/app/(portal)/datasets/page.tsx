import { requireTenantContext } from "@/lib/tenant";
import { services } from "@/services";
import { PageHeader } from "@/components/ui";
import { DatasetExplorer } from "@/components/datasets/dataset-explorer";

export default async function DatasetsPage() {
  const tenant = await requireTenantContext();
  const datasets = await services.datasets.getDatasets(tenant.tenantId);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Data Products"
        description="Data products your organization is entitled to exchange."
      />
      <DatasetExplorer datasets={datasets} />
    </div>
  );
}
