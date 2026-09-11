import { Boxes } from "lucide-react";
import { requireTenantContext } from "@/lib/tenant";
import { isReadOnly } from "@/lib/authorization";
import { env } from "@/config/env";
import { listCatalogProducts } from "@/lib/catalog-service/client";
import { getEntitlementForProduct, listSubscriptions, type SubscriptionDTO } from "@/lib/subscription-service/client";
import { getScheduleStatus, listExecutions, type ExecutionDTO, type ScheduleStatusDTO } from "@/lib/scheduling-service/client";
import { getProductStatus, type ProductStatusDTO } from "@/lib/observability-service/client";
import { Card, CardContent, EmptyState, PageHeader } from "@/components/ui";
import { SubscriptionCard } from "./subscription-card";

export default async function SubscriptionsPage({
  searchParams,
}: {
  searchParams: Promise<{ actionError?: string; actionSuccess?: string }>;
}) {
  const tenant = await requireTenantContext();
  const { actionError, actionSuccess } = await searchParams;

  if (!env.catalogServiceEnabled || !env.subscriptionServiceEnabled) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Subscriptions" description="Subscribe to Data Products you're entitled to and manage delivery preferences." />
        <Card>
          <CardContent>
            <EmptyState
              icon={Boxes}
              title="Subscription service not configured"
              description="Set CATALOG_SERVICE_URL and SUBSCRIPTION_SERVICE_URL to enable this page."
            />
          </CardContent>
        </Card>
      </div>
    );
  }

  // Catalog Service owns Data Products/versions (Phase 5); subscription-service
  // owns entitlement/subscription decisions for them (Phase 6) — this page
  // joins the two client-side rather than either service knowing about the other.
  const { items: products } = await listCatalogProducts();

  const [entitlements, subscriptions] = await Promise.all([
    Promise.all(products.map((product) => getEntitlementForProduct(tenant, product.dataProductId).catch(() => null))),
    listSubscriptions(tenant).catch(() => [] as SubscriptionDTO[]),
  ]);

  const activeSubscriptions = subscriptions.filter((subscription) => subscription.status !== "CANCELLED");
  const subscriptionByProduct = new Map(activeSubscriptions.map((subscription) => [subscription.data_product_id, subscription]));

  // Phase 7 — best-effort: scheduling-service being unset/unreachable, or a
  // subscription not yet reconciled, just means that card's schedule panel
  // doesn't render, never a failure of the page itself.
  const scheduleByProduct = new Map<string, { status: ScheduleStatusDTO; executions: ExecutionDTO[] }>();
  if (env.schedulingServiceEnabled) {
    await Promise.all(
      activeSubscriptions.map(async (subscription) => {
        try {
          const [status, executions] = await Promise.all([
            getScheduleStatus(tenant, subscription.subscription_id),
            listExecutions(tenant, subscription.subscription_id, 5),
          ]);
          scheduleByProduct.set(subscription.data_product_id, { status, executions });
        } catch {
          // Not configured for this subscription yet, or the service is down.
        }
      }),
    );
  }

  // Phase 9 — best-effort, same non-blocking pattern as the schedule
  // panel above. Fetched for every catalog product (like entitlements
  // above), not just already-subscribed ones — operational status is
  // independent of subscription/entitlement state, so a tenant can see
  // it before ever subscribing. observability-service being unset/
  // unreachable, or no operational data yet for this product/tenant,
  // just means the status badge doesn't render.
  const statusByProduct = new Map<string, ProductStatusDTO>();
  if (env.observabilityServiceEnabled) {
    await Promise.all(
      products.map(async (product) => {
        try {
          const status = await getProductStatus(tenant, product.dataProductId);
          statusByProduct.set(product.dataProductId, status);
        } catch {
          // Not observed yet for this tenant/product, or the service is down.
        }
      }),
    );
  }

  const canManage = !isReadOnly(tenant.role);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Subscriptions" description="Subscribe to Data Products you're entitled to and manage delivery preferences." />

      {actionError ? (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="py-3 text-sm text-red-700">{actionError}</CardContent>
        </Card>
      ) : null}
      {actionSuccess ? (
        <Card className="border-green-200 bg-green-50">
          <CardContent className="py-3 text-sm text-emerald-700">Done.</CardContent>
        </Card>
      ) : null}

      {products.length === 0 ? (
        <EmptyState icon={Boxes} title="No Data Products in the Catalog yet" />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {products.map((product) => (
            <SubscriptionCard
              key={product.dataProductId}
              product={product}
              entitlement={entitlements.find((decision) => decision?.data_product_id === product.dataProductId) ?? null}
              subscription={subscriptionByProduct.get(product.dataProductId) ?? null}
              canManage={canManage}
              schedule={scheduleByProduct.get(product.dataProductId) ?? null}
              productStatus={statusByProduct.get(product.dataProductId) ?? null}
            />
          ))}
        </div>
      )}
    </div>
  );
}
