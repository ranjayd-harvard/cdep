import { notFound } from "next/navigation";
import Link from "next/link";
import { requireSuperuserContext } from "@/lib/admin";
import { services } from "@/services";
import {
  PageHeader,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableHeaderCell,
  TableCell,
  StatusBadge,
} from "@/components/ui";
import { createDatasetAction } from "./actions";
import { DatasetForm } from "./dataset-form";
import { DatasetRowActions } from "./dataset-row-actions";

export default async function AdminDataProductDatasetsPage({
  params,
}: {
  params: Promise<{ dataProductId: string }>;
}) {
  await requireSuperuserContext();
  const { dataProductId } = await params;

  const dataProducts = await services.dataProducts.listAllDataProducts();
  const dataProduct = dataProducts.find((dp) => dp.id === dataProductId);
  if (!dataProduct) {
    notFound();
  }

  const datasets = await services.datasets.listDatasetsByDataProduct(dataProductId);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/admin/data-products" className="text-sm text-slate-500 hover:underline">
          &larr; Data Products
        </Link>
        <PageHeader title={dataProduct.displayName} description={dataProduct.description} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Create Dataset</CardTitle>
        </CardHeader>
        <CardContent>
          <DatasetForm
            action={createDatasetAction.bind(null, dataProductId)}
            submitLabel="Create dataset"
            pendingLabel="Creating…"
          />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>Display Name</TableHeaderCell>
                <TableHeaderCell>ID</TableHeaderCell>
                <TableHeaderCell>Version</TableHeaderCell>
                <TableHeaderCell>Format</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
                <TableHeaderCell>Actions</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {datasets.map((dataset) => (
                <TableRow key={dataset.id}>
                  <TableCell className="font-medium text-slate-900">{dataset.displayName}</TableCell>
                  <TableCell className="font-mono text-xs">{dataset.id}</TableCell>
                  <TableCell>{dataset.version}</TableCell>
                  <TableCell>{dataset.format}</TableCell>
                  <TableCell>
                    <StatusBadge status={dataset.status} />
                  </TableCell>
                  <TableCell>
                    <DatasetRowActions dataProductId={dataProductId} dataset={dataset} />
                  </TableCell>
                </TableRow>
              ))}
              {datasets.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-slate-500">
                    No datasets yet — this data product won&apos;t show up in the portal until it has at least
                    one.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
