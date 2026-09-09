import { requireSuperuserContext } from "@/lib/admin";
import { services } from "@/services";
import { PageHeader } from "@/components/ui";
import { organizationNode } from "@/lib/relationship-graph";
import { DataRelationshipsExplorer } from "./data-relationships-explorer";

export default async function AdminDataRelationshipsPage() {
  await requireSuperuserContext();

  const [organizations, dataProducts, datasets] = await Promise.all([
    services.organizations.listOrganizations(),
    services.dataProducts.listAllDataProducts(),
    services.datasets.listAllDatasets(),
  ]);

  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col gap-4">
      <PageHeader
        title="Data Product Relationships"
        description="Explore and manage organizations, tenants, entitlements, data products, and datasets."
      />
      <DataRelationshipsExplorer
        initialNodes={organizations.map(organizationNode)}
        dataProducts={dataProducts}
        datasets={datasets}
      />
    </div>
  );
}
