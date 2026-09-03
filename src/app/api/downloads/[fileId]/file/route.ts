import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { requireApiTenantContext } from "@/lib/api-auth";
import { verifyDownloadToken } from "@/lib/download-tokens";
import { getDownloadById, getDownloadStorageFileId } from "@/lib/download-directory";
import { openDownloadStream } from "@/lib/file-storage";

/**
 * Requires both a valid session (defense in depth — the token alone
 * would be enough) and a signed, short-lived token bound to this exact
 * `fileId`/tenant, minted by `MongoDownloadService.getDownloadUrl`. A
 * token minted for a different file cannot be replayed against this one.
 */
export async function GET(request: Request, { params }: { params: Promise<{ fileId: string }> }) {
  const ctx = await requireApiTenantContext();
  if (!ctx.ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: ctx.status });
  }

  const { fileId } = await params;
  const token = new URL(request.url).searchParams.get("token");
  if (!token || !(await verifyDownloadToken(token, fileId, ctx.tenant.tenantId))) {
    return NextResponse.json({ error: "Invalid or expired download link." }, { status: 403 });
  }

  const [file, storageFileId] = await Promise.all([
    getDownloadById(ctx.tenant.tenantId, fileId),
    getDownloadStorageFileId(ctx.tenant.tenantId, fileId),
  ]);
  if (!file || !storageFileId) {
    return NextResponse.json({ error: "File not found." }, { status: 404 });
  }

  const nodeStream = await openDownloadStream(storageFileId);
  const webStream = Readable.toWeb(nodeStream) as ReadableStream;

  return new NextResponse(webStream, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${file.filename}"`,
      "Content-Length": String(file.sizeBytes),
    },
  });
}
