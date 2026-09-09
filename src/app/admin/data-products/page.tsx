import Link from "next/link";
import { requireSuperuserContext } from "@/lib/admin";
import { services } from "@/services";
import { listAllAssociations } from "@/lib/data-product-dataset-directory";
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
import { CreateDataProductForm } from "./create-data-product-form";
import { DataProductRowActions } from "./data-product-row-actions";

export default async function AdminDataProductsPage() {
  await requireSuperuserContext();

  const dataProducts = await services.dataProducts.listAllDataProducts();
  const associations = await listAllAssociations();
  const datasetCountByProduct = new Map<string, number>();
  for (const association of associations) {
    datasetCountByProduct.set(
      association.dataProductId,
      (datasetCountByProduct.get(association.dataProductId) ?? 0) + 1,
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Data Products"
        description="The shared catalog every tenant's Entitlements grant against."
      />

      <Card>
        <CardHeader>
          <CardTitle>Create Data Product</CardTitle>
        </CardHeader>
        <CardContent>
          <CreateDataProductForm />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>Display Name</TableHeaderCell>
                <TableHeaderCell>ID</TableHeaderCell>
                <TableHeaderCell>Domain</TableHeaderCell>
                <TableHeaderCell>Owner</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
                <TableHeaderCell>Datasets</TableHeaderCell>
                <TableHeaderCell>Actions</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {dataProducts.map((dataProduct) => (
                <TableRow key={dataProduct.id}>
                  <TableCell className="font-medium text-slate-900">{dataProduct.displayName}</TableCell>
                  <TableCell className="font-mono text-xs">{dataProduct.id}</TableCell>
                  <TableCell>{dataProduct.domain}</TableCell>
                  <TableCell>{dataProduct.owner}</TableCell>
                  <TableCell>
                    <StatusBadge status={dataProduct.status} />
                  </TableCell>
                  <TableCell>{datasetCountByProduct.get(dataProduct.id) ?? 0}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Link
                        href={`/admin/data-products/${dataProduct.id}`}
                        className="text-sm font-medium text-slate-700 hover:underline"
                      >
                        Manage Datasets
                      </Link>
                      <DataProductRowActions dataProduct={dataProduct} />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {dataProducts.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center text-slate-500">
                    No data products yet — create one above.
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
