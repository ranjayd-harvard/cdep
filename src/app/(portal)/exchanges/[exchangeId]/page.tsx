import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireTenantContext } from "@/lib/tenant";
import { services } from "@/services";
import { PageHeader, StatusBadge } from "@/components/ui";
import { ExchangeDetail } from "@/components/exchanges/exchange-detail";

interface ExchangeDetailPageProps {
  params: Promise<{ exchangeId: string }>;
}

export default async function ExchangeDetailPage({ params }: ExchangeDetailPageProps) {
  const { exchangeId } = await params;
  const tenant = await requireTenantContext();
  const exchange = await services.exchanges.getExchange(tenant, exchangeId);

  if (!exchange) {
    notFound();
  }

  const dataset = await services.datasets.getDataset(tenant.tenantId, exchange.datasetId);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href="/exchanges"
          className="mb-3 inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-900"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to Exchanges
        </Link>
        <PageHeader
          title={exchange.id}
          description={`${exchange.direction} exchange for ${dataset?.displayName ?? exchange.datasetId}`}
          actions={<StatusBadge status={exchange.status} />}
        />
      </div>
      <ExchangeDetail exchange={exchange} dataset={dataset} />
    </div>
  );
}
