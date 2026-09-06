"use client";

import { useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { useSession } from "next-auth/react";
import { UploadCloud, FileText } from "lucide-react";
import type { Dataset, UploadResult } from "@/models";
import { UploadStatus } from "@/models";
import { clientServices } from "@/services/client";
import { toTenantContext } from "@/lib/client-tenant-context";
import { Button, Select, Card, CardContent, StatusBadge } from "@/components/ui";
import { formatBytes } from "@/lib/utils";
import { ACCEPTED_UPLOAD_EXTENSIONS, MAX_UPLOAD_SIZE_BYTES, isAcceptedUploadFile } from "@/lib/upload-validation";

export function UploadForm({ datasets }: { datasets: Dataset[] }) {
  const { data: session } = useSession();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [datasetId, setDatasetId] = useState(datasets[0]?.id ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [result, setResult] = useState<UploadResult | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0] ?? null;
    setResult(null);
    setValidationError(null);

    if (!selected) {
      setFile(null);
      return;
    }

    if (!isAcceptedUploadFile(selected.name)) {
      setValidationError(`Unsupported file type. Accepted types: ${ACCEPTED_UPLOAD_EXTENSIONS.join(", ")}`);
      setFile(null);
      return;
    }

    if (selected.size > MAX_UPLOAD_SIZE_BYTES) {
      setValidationError(`File exceeds the maximum size of ${formatBytes(MAX_UPLOAD_SIZE_BYTES)}.`);
      setFile(null);
      return;
    }

    setFile(selected);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const context = toTenantContext(session?.user);
    if (!file || !datasetId || !context) return;

    setSubmitting(true);
    setValidationError(null);

    try {
      await clientServices.uploads.uploadFile(
        context,
        file,
        { datasetId, filename: file.name, fileSize: file.size, fileType: file.type },
        (progress) => setResult(progress),
      );
    } catch {
      setValidationError("Upload failed unexpectedly. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  function handleReset() {
    setFile(null);
    setResult(null);
    setValidationError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  const isComplete = result?.status === UploadStatus.COMPLETED;

  return (
    <Card>
      <CardContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          <Select
            label="Data Product"
            value={datasetId}
            onChange={(event) => setDatasetId(event.target.value)}
            disabled={submitting}
            options={datasets.map((dataset) => ({ value: dataset.id, label: dataset.displayName }))}
          />

          <div className="flex flex-col gap-1.5">
            <label htmlFor="upload-file" className="text-sm font-medium text-slate-700">
              File
            </label>
            <div className="flex items-center gap-3 rounded-md border border-dashed border-slate-300 px-4 py-6">
              <UploadCloud className="h-6 w-6 shrink-0 text-slate-400" aria-hidden="true" />
              <div className="flex-1 text-sm text-slate-600">
                {file ? (
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-slate-400" aria-hidden="true" />
                    <span className="font-medium text-slate-900">{file.name}</span>
                    <span className="text-xs text-slate-400">{formatBytes(file.size)}</span>
                  </div>
                ) : (
                  <span>Select a .csv, .json, or .parquet file to upload.</span>
                )}
              </div>
              <input
                ref={fileInputRef}
                id="upload-file"
                type="file"
                accept={ACCEPTED_UPLOAD_EXTENSIONS.join(",")}
                onChange={handleFileChange}
                disabled={submitting}
                className="text-sm"
              />
            </div>
            {validationError ? (
              <p role="alert" className="text-xs text-red-600">
                {validationError}
              </p>
            ) : null}
          </div>

          {result ? (
            <div className="flex flex-col gap-2 rounded-md border border-slate-200 p-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-slate-700">Upload status</span>
                <StatusBadge status={result.status} />
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-slate-900 transition-all"
                  style={{ width: `${result.progress}%` }}
                />
              </div>
              {result.message ? <p className="text-xs text-slate-500">{result.message}</p> : null}
            </div>
          ) : null}

          <div className="flex gap-2">
            <Button type="submit" disabled={!file || !datasetId || submitting || isComplete}>
              {submitting ? "Uploading…" : "Upload"}
            </Button>
            {file || result ? (
              <Button type="button" variant="secondary" onClick={handleReset} disabled={submitting}>
                Reset
              </Button>
            ) : null}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
