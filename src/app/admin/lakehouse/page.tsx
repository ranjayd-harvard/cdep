import { Layers } from "lucide-react";
import { requireSuperuserContext } from "@/lib/admin";
import { services } from "@/services";
import { PageHeader, Card, CardContent, EmptyState } from "@/components/ui";
import { IngestionTable } from "./ingestion-table";
import { LakehouseSubNav } from "./lakehouse-sub-nav";

export default async function AdminLakehousePage({
  searchParams,
}: {
  searchParams: Promise<{
    ranExchangeId?: string;
    ranStatus?: string;
    ranErrorCode?: string;
    ranErrorMessage?: string;
  }>;
}) {
  await requireSuperuserContext();

  const { ranExchangeId, ranStatus, ranErrorCode, ranErrorMessage } = await searchParams;
  const { available, items } = await services.lakehouseAdmin.listRecentExchangesWithIngestionStatus(50);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Lakehouse Ingestion"
        description="Recent exchanges across every tenant and their Bronze ingestion status."
      />

      <LakehouseSubNav active="/admin/lakehouse" />

      {ranExchangeId ? (
        <Card className={ranErrorCode ? "border-red-200 bg-red-50" : "border-green-200 bg-green-50"}>
          <CardContent className="flex items-center justify-between gap-4 py-3 text-sm">
            <span>
              Ingestion for <span className="font-mono">{ranExchangeId}</span>:{" "}
              <span className="font-semibold">{ranStatus}</span>
              {ranErrorMessage ? ` — ${ranErrorMessage}` : null}
            </span>
          </CardContent>
        </Card>
      ) : null}

      {!available ? (
        <Card>
          <CardContent>
            <EmptyState
              icon={Layers}
              title="Lakehouse integration not configured"
              description="Set EXCHANGE_SERVICE_URL and LAKEHOUSE_SERVICE_URL to enable this page."
            />
          </CardContent>
        </Card>
      ) : (
        <IngestionTable items={items} />
      )}
    </div>
  );
}
