import { requireTenantContext } from "@/lib/tenant";
import { services } from "@/services";
import {
  PageHeader,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableHeaderCell,
  TableCell,
  EmptyState,
} from "@/components/ui";
import { formatBytes, formatDateTime } from "@/lib/utils";
import { DownloadButton } from "./download-button";

export default async function DownloadsPage() {
  const tenant = await requireTenantContext();
  const [downloads, datasets] = await Promise.all([
    services.downloads.getDownloads(tenant),
    services.datasets.getDatasets(tenant.tenantId),
  ]);

  const datasetNameById = new Map(datasets.map((dataset) => [dataset.id, dataset.displayName]));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Downloads"
        description="Outbound files your organization can download from the platform."
      />

      {downloads.length === 0 ? (
        <EmptyState title="No files available for download" />
      ) : (
        <Table>
          <TableHead>
            <TableRow>
              <TableHeaderCell>Dataset</TableHeaderCell>
              <TableHeaderCell>Filename</TableHeaderCell>
              <TableHeaderCell>Format</TableHeaderCell>
              <TableHeaderCell>Generated</TableHeaderCell>
              <TableHeaderCell>Size</TableHeaderCell>
              <TableHeaderCell>Expires</TableHeaderCell>
              <TableHeaderCell>Action</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {downloads.map((file) => (
              <TableRow key={file.id}>
                <TableCell>{datasetNameById.get(file.datasetId) ?? file.datasetId}</TableCell>
                <TableCell className="font-mono text-xs">{file.filename}</TableCell>
                <TableCell>{file.format}</TableCell>
                <TableCell>{formatDateTime(file.generatedAt)}</TableCell>
                <TableCell>{formatBytes(file.sizeBytes)}</TableCell>
                <TableCell>{formatDateTime(file.expiresAt)}</TableCell>
                <TableCell>
                  <DownloadButton fileId={file.id} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
