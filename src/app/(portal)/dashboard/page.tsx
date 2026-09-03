import { requireTenantContext } from "@/lib/tenant";
import { services } from "@/services";
import { ExchangeStatus } from "@/models";
import { PageHeader, Card, CardHeader, CardTitle, CardContent } from "@/components/ui";
import { SummaryCards } from "@/components/dashboard/summary-cards";
import {
  RecentExchangesTable,
  type RecentExchangeRow,
} from "@/components/dashboard/recent-exchanges-table";
import { DataProductsPreview } from "@/components/dashboard/data-products-preview";
import { NotificationsPreview } from "@/components/dashboard/notifications-preview";

export default async function DashboardPage() {
  const tenant = await requireTenantContext();

  const [datasets, exchanges, notifications] = await Promise.all([
    services.datasets.getDatasets(tenant.tenantId),
    services.exchanges.getExchanges(tenant.tenantId),
    services.notifications.getNotifications(tenant.tenantId),
  ]);

  const datasetNameById = new Map(datasets.map((dataset) => [dataset.id, dataset.displayName]));

  const now = new Date();
  const completedThisMonth = exchanges.filter((exchange) => {
    if (exchange.status !== ExchangeStatus.COMPLETED || !exchange.completedAt) return false;
    const completedDate = new Date(exchange.completedAt);
    return (
      completedDate.getUTCFullYear() === now.getUTCFullYear() &&
      completedDate.getUTCMonth() === now.getUTCMonth()
    );
  }).length;

  const activeStatuses: ExchangeStatus[] = [
    ExchangeStatus.RECEIVED,
    ExchangeStatus.VALIDATING,
    ExchangeStatus.PROCESSING,
  ];
  const activeExchanges = exchanges.filter((exchange) =>
    activeStatuses.includes(exchange.status),
  ).length;

  const failedExchanges = exchanges.filter(
    (exchange) => exchange.status === ExchangeStatus.FAILED,
  ).length;

  const recentExchangeRows: RecentExchangeRow[] = [...exchanges]
    .sort((a, b) => new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime())
    .slice(0, 6)
    .map((exchange) => ({
      id: exchange.id,
      datasetName: datasetNameById.get(exchange.datasetId) ?? exchange.datasetId,
      direction: exchange.direction,
      receivedAt: exchange.receivedAt,
      status: exchange.status,
      recordCount: exchange.recordCount,
    }));

  const recentDatasets = [...datasets]
    .sort((a, b) => new Date(b.lastUpdated).getTime() - new Date(a.lastUpdated).getTime())
    .slice(0, 3);

  const recentNotifications = notifications.slice(0, 5);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={`Welcome back, ${tenant.name.split(" ")[0]}`}
        description="Here's what's happening with your data exchanges today."
      />

      <SummaryCards
        availableDataProducts={datasets.length}
        activeExchanges={activeExchanges}
        completedThisMonth={completedThisMonth}
        failedExchanges={failedExchanges}
      />

      <Card>
        <CardHeader>
          <CardTitle>Recent Exchanges</CardTitle>
        </CardHeader>
        <CardContent>
          <RecentExchangesTable rows={recentExchangeRows} />
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle>Available Data Products</CardTitle>
          </CardHeader>
          <CardContent>
            <DataProductsPreview datasets={recentDatasets} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Notifications</CardTitle>
          </CardHeader>
          <CardContent>
            <NotificationsPreview notifications={recentNotifications} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
