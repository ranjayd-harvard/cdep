import { NextResponse } from "next/server";
import { requireApiTenantContext } from "@/lib/api-auth";
import { services } from "@/services";

export async function POST(_request: Request, { params }: { params: Promise<{ notificationId: string }> }) {
  const ctx = await requireApiTenantContext();
  if (!ctx.ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: ctx.status });
  }

  const { notificationId } = await params;
  await services.notifications.markAsRead(ctx.tenant.tenantId, notificationId);
  return NextResponse.json({ ok: true });
}
