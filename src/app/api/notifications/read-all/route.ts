import { NextResponse } from "next/server";
import { requireApiTenantContext } from "@/lib/api-auth";
import { services } from "@/services";

export async function POST() {
  const ctx = await requireApiTenantContext();
  if (!ctx.ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: ctx.status });
  }

  await services.notifications.markAllAsRead(ctx.tenant.tenantId);
  return NextResponse.json({ ok: true });
}
