import { requireTenantContext } from "@/lib/tenant";
import { services } from "@/services";
import { canUploadData } from "@/lib/authorization";
import { PageHeader, UnauthorizedState } from "@/components/ui";
import { UploadForm } from "@/components/upload/upload-form";

export default async function UploadPage() {
  const tenant = await requireTenantContext();

  if (!canUploadData(tenant.role)) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Upload Data" description="Submit inbound data files for processing." />
        <UnauthorizedState description="Your role does not have permission to upload data. Contact your customer administrator." />
      </div>
    );
  }

  const datasets = await services.datasets.getDatasets(tenant.tenantId);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Upload Data" description="Submit inbound data files for processing." />
      <UploadForm datasets={datasets} />
    </div>
  );
}
