import { requireTenantContext } from "@/lib/tenant";
import { services } from "@/services";
import { PageHeader } from "@/components/ui";
import { ExchangeExplorer } from "@/components/exchanges/exchange-explorer";

export default async function ExchangesPage() {
  const tenant = await requireTenantContext();
  const [exchanges, datasets] = await Promise.all([
    services.exchanges.getExchanges(tenant),
    services.datasets.getDatasets(tenant.tenantId),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Exchanges"
        description="Inbound and outbound data exchanges between your organization and the platform."
      />
      <ExchangeExplorer exchanges={exchanges} datasets={datasets} />
    </div>
  );
}
