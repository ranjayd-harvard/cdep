"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireTenantContext, type TenantContext } from "@/lib/tenant";
import { isReadOnly } from "@/lib/authorization";
import {
  SubscriptionServiceError,
  createSubscription as createSubscriptionRequest,
  pauseSubscription as pauseSubscriptionRequest,
  resumeSubscription as resumeSubscriptionRequest,
  cancelSubscription as cancelSubscriptionRequest,
  type DayOfWeek,
  type SubscriptionFrequency,
} from "@/lib/subscription-service/client";

export interface CreateSubscriptionState {
  error?: string;
  success?: string;
}

/**
 * Runs the full spec §37 pipeline server-side (subscription-service
 * validates catalog/entitlement/version-policy/delivery-capability itself
 * — this action only forwards the form and surfaces whatever it says).
 */
export async function createSubscription(
  dataProductId: string,
  _prevState: CreateSubscriptionState,
  formData: FormData,
): Promise<CreateSubscriptionState> {
  const tenant = await requireTenantContext();
  if (isReadOnly(tenant.role)) {
    return { error: "Your role does not allow creating subscriptions." };
  }

  const versionPolicy = String(formData.get("versionPolicy") ?? "").trim() || "latest";
  const method = String(formData.get("method") ?? "").trim();
  const format = String(formData.get("format") ?? "").trim();
  const frequency = String(formData.get("frequency") ?? "").trim();
  const deliveryTime = String(formData.get("deliveryTime") ?? "").trim();
  const timezone = String(formData.get("timezone") ?? "").trim();
  const retentionDaysRaw = String(formData.get("retentionDays") ?? "").trim();
  const dayOfWeek = String(formData.get("dayOfWeek") ?? "").trim();
  const cronExpression = String(formData.get("cronExpression") ?? "").trim();

  if (method !== "FILE" && method !== "API") {
    return { error: "Choose a delivery method." };
  }
  if (!frequency) {
    return { error: "Choose a frequency." };
  }
  if (frequency === "CRON" && !cronExpression) {
    return { error: "A cron expression is required for CRON frequency." };
  }

  try {
    await createSubscriptionRequest(tenant, {
      data_product_id: dataProductId,
      version_policy: versionPolicy,
      delivery: {
        method,
        format: method === "FILE" && format ? format : undefined,
        frequency: frequency as SubscriptionFrequency,
        delivery_time: frequency !== "CRON" ? deliveryTime || undefined : undefined,
        timezone: timezone || undefined,
        retention_days: retentionDaysRaw ? Number(retentionDaysRaw) : undefined,
        day_of_week: frequency === "WEEKLY" && dayOfWeek ? (dayOfWeek as DayOfWeek) : undefined,
        cron_expression: frequency === "CRON" && cronExpression ? cronExpression : undefined,
      },
    });
  } catch (err) {
    return { error: err instanceof SubscriptionServiceError ? err.message : "Failed to create subscription." };
  }

  revalidatePath("/subscriptions");
  return { success: "Subscription created." };
}

/**
 * Shared plumbing for the no-form lifecycle actions below — same
 * redirect-with-a-flash-query-param convention already used by
 * `src/app/admin/lakehouse/actions.ts`, since these actions are invoked
 * from plain `<form action={...}>` elements (no client JS / useActionState)
 * and still need to surface a rejection like PRODUCT_NOT_ENTITLED.
 */
async function runTransition(
  request: (tenant: TenantContext, subscriptionId: string) => Promise<unknown>,
  subscriptionId: string,
): Promise<never> {
  const tenant = await requireTenantContext();
  if (isReadOnly(tenant.role)) {
    redirect(`/subscriptions?actionError=${encodeURIComponent("Your role does not allow this action.")}`);
  }

  try {
    await request(tenant, subscriptionId);
  } catch (err) {
    const message = err instanceof SubscriptionServiceError ? err.message : "Action failed.";
    redirect(`/subscriptions?actionError=${encodeURIComponent(message)}`);
  }

  revalidatePath("/subscriptions");
  redirect("/subscriptions?actionSuccess=1");
}

export async function pauseSubscription(subscriptionId: string): Promise<void> {
  await runTransition(pauseSubscriptionRequest, subscriptionId);
}

export async function resumeSubscription(subscriptionId: string): Promise<void> {
  await runTransition(resumeSubscriptionRequest, subscriptionId);
}

export async function cancelSubscription(subscriptionId: string): Promise<void> {
  await runTransition(cancelSubscriptionRequest, subscriptionId);
}
