import { Button, Card, CardContent, CardHeader, CardTitle, StatusBadge } from "@/components/ui";
import type { CatalogProductSummaryDTO } from "@/lib/catalog-service/client";
import type { EntitlementDecisionDTO, SubscriptionDTO } from "@/lib/subscription-service/client";
import type { ExecutionDTO, ScheduleStatusDTO } from "@/lib/scheduling-service/client";
import type { ProductStatusDTO } from "@/lib/observability-service/client";
import { formatDateTime } from "@/lib/utils";
import { cancelSubscription, pauseSubscription, resumeSubscription } from "./subscription-actions";
import { SubscribeForm } from "./subscribe-form";
import { SchedulePanel } from "./schedule-panel";

function formatVersionPolicy(policy: SubscriptionDTO["version_policy"]): string {
  switch (policy.type) {
    case "EXACT":
      return policy.value ?? "—";
    case "COMPATIBLE_PATCH":
      return `${policy.value}.x`;
    case "COMPATIBLE_MINOR":
      return `${policy.value}.x`;
    case "PINNED_MAJOR":
      return `${policy.value} (pinned)`;
    case "LATEST_ACTIVE":
      return "latest";
    default:
      return policy.value ?? "—";
  }
}

export function SubscriptionCard({
  product,
  entitlement,
  subscription,
  canManage,
  schedule,
  productStatus,
}: {
  product: CatalogProductSummaryDTO;
  entitlement: EntitlementDecisionDTO | null;
  subscription: SubscriptionDTO | null;
  canManage: boolean;
  // Phase 7 — null when scheduling-service isn't configured, unreachable,
  // or hasn't reconciled this subscription yet; the panel just doesn't
  // render rather than blocking the rest of the card.
  schedule: { status: ScheduleStatusDTO; executions: ExecutionDTO[] } | null;
  // Phase 9 — null when observability-service isn't configured, or no
  // operational data has been observed yet for this tenant/product.
  productStatus: ProductStatusDTO | null;
}) {
  const isEntitled = entitlement?.decision === "ALLOW";

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle>{product.name}</CardTitle>
        <div className="flex items-center gap-2">
          {productStatus ? <StatusBadge status={productStatus.status} /> : null}
          <StatusBadge status={entitlement?.decision ?? "DENY"} />
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-sm">
        <p className="text-slate-600">{product.description ?? "No description."}</p>

        <dl className="grid grid-cols-2 gap-3 text-xs">
          <div>
            <dt className="uppercase tracking-wide text-slate-400">Domain</dt>
            <dd className="mt-0.5 font-medium text-slate-900">{product.domain?.name ?? "—"}</dd>
          </div>
          <div>
            <dt className="uppercase tracking-wide text-slate-400">Active version</dt>
            <dd className="mt-0.5 font-medium text-slate-900">{product.activeVersion ?? "—"}</dd>
          </div>
        </dl>

        {!isEntitled ? (
          <p className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-500">
            {entitlement?.reason === "NO_ENTITLEMENT"
              ? "Your tenant has not been granted access to this product yet."
              : `Access is not currently permitted (${entitlement?.reason ?? "unknown reason"}).`}
          </p>
        ) : subscription ? (
          <div className="flex flex-col gap-3 rounded-md border border-slate-200 p-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-slate-900">Your subscription</span>
              <StatusBadge status={subscription.status} />
            </div>

            <dl className="grid grid-cols-2 gap-2 text-xs text-slate-600">
              <div>
                <dt className="text-slate-400">Version policy</dt>
                <dd className="font-medium text-slate-800">{formatVersionPolicy(subscription.version_policy)}</dd>
              </div>
              <div>
                <dt className="text-slate-400">Delivery</dt>
                <dd className="font-medium text-slate-800">
                  {subscription.delivery.method}
                  {subscription.delivery.format ? ` / ${subscription.delivery.format}` : ""}
                </dd>
              </div>
              <div>
                <dt className="text-slate-400">Frequency</dt>
                <dd className="font-medium text-slate-800">
                  {subscription.delivery.frequency}
                  {subscription.delivery.day_of_week ? ` (${subscription.delivery.day_of_week})` : ""}
                  {subscription.delivery.delivery_time ? ` @ ${subscription.delivery.delivery_time} ${subscription.delivery.timezone ?? ""}` : ""}
                  {subscription.delivery.cron_expression ? ` "${subscription.delivery.cron_expression}" ${subscription.delivery.timezone ?? ""}` : ""}
                </dd>
              </div>
              <div>
                <dt className="text-slate-400">Retention</dt>
                <dd className="font-medium text-slate-800">
                  {subscription.delivery.retention_days ? `${subscription.delivery.retention_days} days` : "—"}
                </dd>
              </div>
            </dl>

            {productStatus ? (
              <div className="flex flex-col gap-2 rounded-md border border-slate-200 p-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-slate-900">Operational status</span>
                  <StatusBadge status={productStatus.sla.status} />
                </div>
                <dl className="grid grid-cols-2 gap-2 text-xs text-slate-600">
                  <div>
                    <dt className="text-slate-400">Freshness</dt>
                    <dd className="font-medium text-slate-800">
                      {productStatus.freshnessMinutes !== null ? `${productStatus.freshnessMinutes} min` : "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-400">Last delivery</dt>
                    <dd className="font-medium text-slate-800">
                      {productStatus.lastSuccessfulDeliveryAt ? formatDateTime(productStatus.lastSuccessfulDeliveryAt) : "—"}
                    </dd>
                  </div>
                </dl>
              </div>
            ) : null}

            {subscription.suspension_reason ? (
              <p className="text-xs text-amber-700">Suspended — {subscription.suspension_reason}</p>
            ) : null}
            {subscription.cancellation_reason ? (
              <p className="text-xs text-slate-500">Cancelled — {subscription.cancellation_reason}</p>
            ) : null}

            <p className="text-xs text-slate-400">Requested {formatDateTime(subscription.requested_at)}</p>

            {canManage && subscription.status !== "CANCELLED" ? (
              <div className="flex flex-wrap gap-2 pt-1">
                {subscription.status === "ACTIVE" ? (
                  <form action={pauseSubscription.bind(null, subscription.subscription_id)}>
                    <Button type="submit" size="sm" variant="secondary">
                      Pause
                    </Button>
                  </form>
                ) : null}
                {subscription.status === "PAUSED" || subscription.status === "SUSPENDED" ? (
                  <form action={resumeSubscription.bind(null, subscription.subscription_id)}>
                    <Button type="submit" size="sm" variant="secondary">
                      Resume
                    </Button>
                  </form>
                ) : null}
                <form action={cancelSubscription.bind(null, subscription.subscription_id)}>
                  <Button type="submit" size="sm" variant="danger">
                    Cancel
                  </Button>
                </form>
              </div>
            ) : null}

            {schedule ? (
              <SchedulePanel subscriptionId={subscription.subscription_id} status={schedule.status} executions={schedule.executions} canManage={canManage} />
            ) : null}
          </div>
        ) : canManage ? (
          <SubscribeForm dataProductId={product.dataProductId} activeVersion={product.activeVersion} deliveryMethods={product.supportedDeliveryMethods} />
        ) : (
          <p className="text-xs text-slate-500">Not subscribed.</p>
        )}

        {!canManage ? <p className="text-xs text-slate-400">Read-only access — ask an admin or standard user to manage subscriptions.</p> : null}
      </CardContent>
    </Card>
  );
}
