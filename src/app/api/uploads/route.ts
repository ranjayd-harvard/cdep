import { NextResponse } from "next/server";
import { requireApiTenantContext } from "@/lib/api-auth";
import { canUploadData } from "@/lib/authorization";
import { services } from "@/services";
import { ACCEPTED_UPLOAD_EXTENSIONS, MAX_UPLOAD_SIZE_BYTES, isAcceptedUploadFile } from "@/lib/upload-validation";

/**
 * Not covered by `src/proxy.ts` (its matcher only guards page routes), so
 * auth/authorization is checked here directly rather than assumed.
 *
 * `request.formData()` buffers the whole multipart body into memory
 * before anything below can run — there's no streaming multipart parser
 * available via the standard Fetch API, and adding one (`busboy`/
 * `multer`) is out of scope. Acceptable for a single-container app with
 * the 250MB cap enforced below; a known Phase-1-going-real tradeoff, not
 * an oversight.
 */
export async function POST(request: Request) {
  const ctx = await requireApiTenantContext();
  if (!ctx.ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: ctx.status });
  }
  if (!canUploadData(ctx.tenant.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const formData = await request.formData();
  const file = formData.get("file");
  const datasetId = formData.get("datasetId");

  if (!(file instanceof File) || typeof datasetId !== "string" || !datasetId) {
    return NextResponse.json({ error: "A file and datasetId are required." }, { status: 400 });
  }

  // Never trust client-side validation alone — re-check here from the
  // actual parsed File, not from separate form fields that could be
  // spoofed independently of the bytes attached.
  if (!isAcceptedUploadFile(file.name) || file.size > MAX_UPLOAD_SIZE_BYTES) {
    return NextResponse.json(
      { error: `File must be one of ${ACCEPTED_UPLOAD_EXTENSIONS.join(", ")} and under the size limit.` },
      { status: 400 },
    );
  }

  const result = await services.uploads.uploadFile(ctx.tenant, file, {
    datasetId,
    filename: file.name,
    fileSize: file.size,
    fileType: file.type,
  });

  return NextResponse.json(result);
}
