import { NextResponse } from "next/server";
import { requireApiTenantContext } from "@/lib/api-auth";
import { services } from "@/services";

export async function GET(_request: Request, { params }: { params: Promise<{ fileId: string }> }) {
  const ctx = await requireApiTenantContext();
  if (!ctx.ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: ctx.status });
  }

  const { fileId } = await params;

  try {
    const url = await services.downloads.getDownloadUrl(ctx.tenant.tenantId, fileId);
    return NextResponse.json(url);
  } catch {
    return NextResponse.json({ error: "File not found." }, { status: 404 });
  }
}
