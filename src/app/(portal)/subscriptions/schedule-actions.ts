"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireTenantContext } from "@/lib/tenant";
import { isReadOnly } from "@/lib/authorization";
import { SchedulingServiceError, triggerPublication } from "@/lib/scheduling-service/client";

/**
 * Same redirect-with-a-flash-query-param convention as the lifecycle
 * actions in subscription-actions.ts — this is invoked from a plain
 * `<form action={...}>`, no client JS, and still needs to surface a
 * rejection (e.g. the subscription isn't ACTIVE).
 */
export async function publishNow(subscriptionId: string): Promise<never> {
  const tenant = await requireTenantContext();
  if (isReadOnly(tenant.role)) {
    redirect(`/subscriptions?actionError=${encodeURIComponent("Your role does not allow this action.")}`);
  }

  try {
    await triggerPublication(tenant, subscriptionId);
  } catch (err) {
    const message = err instanceof SchedulingServiceError ? err.message : "Failed to trigger publication.";
    redirect(`/subscriptions?actionError=${encodeURIComponent(message)}`);
  }

  revalidatePath("/subscriptions");
  redirect("/subscriptions?actionSuccess=1");
}
