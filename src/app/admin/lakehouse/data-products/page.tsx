import { Database } from "lucide-react";
import Link from "next/link";
import { requireSuperuserContext } from "@/lib/admin";
import { services } from "@/services";
import {
  PageHeader,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  EmptyState,
  StatusBadge,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableHeaderCell,
  TableCell,
} from "@/components/ui";
import { cn } from "@/lib/utils";
import { LakehouseSubNav } from "../lakehouse-sub-nav";

export default async function AdminDataProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ product?: string }>;
}) {
  await requireSuperuserContext();
  const { product } = await searchParams;
  const { available, items } = await services.lakehouseAdmin.listDataProducts();
  const selectedId = product ?? items[0]?.dataProductId;
  const selected = items.find((p) => p.dataProductId === selectedId);
  const rows = available && selectedId ? await services.lakehouseAdmin.getDataProductRows(selectedId, 200) : [];

  const businessColumns = rows.length > 0 ? Object.keys(rows[0]).filter((c) => !c.startsWith("_")) : [];
  const lineageColumns = rows.length > 0 ? Object.keys(rows[0]).filter((c) => c.startsWith("_")) : [];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Data Products (Gold)"
        description="Business-ready Gold Data Products, across every tenant."
      />

      <LakehouseSubNav active="/admin/lakehouse/data-products" />

      {!available ? (
        <Card>
          <CardContent>
            <EmptyState
              icon={Database}
              title="Lakehouse integration not configured"
              description="Set LAKEHOUSE_SERVICE_URL to enable this page."
            />
          </CardContent>
        </Card>
      ) : items.length === 0 ? (
        <Card>
          <CardContent>
            <EmptyState
              icon={Database}
              title="No Data Products registered"
              description="Seed lakehouse.data_products, or run a Silver → Gold pipeline from the Pipelines page."
            />
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {items.map((p) => (
              <Link
                key={p.dataProductId}
                href={`/admin/lakehouse/data-products?product=${p.dataProductId}`}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-sm font-medium",
                  p.dataProductId === selectedId
                    ? "border-slate-900 bg-slate-900 text-white"
                    : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50",
                )}
              >
                {p.displayName}
              </Link>
            ))}
          </div>

          {selected ? (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>{selected.displayName}</CardTitle>
                  <p className="mt-1 text-xs text-slate-500">
                    {selected.dataProductId} · v{selected.version} · {selected.goldTable} · owner:{" "}
                    {selected.owner}
                  </p>
                </div>
                <StatusBadge status={selected.status} />
              </CardHeader>
              <CardContent>
                {selected.description ? (
                  <p className="mb-4 text-sm text-slate-600">{selected.description}</p>
                ) : null}
                {rows.length === 0 ? (
                  <p className="text-sm text-slate-500">
                    No rows yet — run Silver → Gold from the{" "}
                    <Link href="/admin/lakehouse/pipelines" className="underline">
                      Pipelines page
                    </Link>
                    .
                  </p>
                ) : (
                  <div className="flex flex-col gap-4">
                    <Table>
                      <TableHead>
                        <TableRow>
                          {businessColumns.map((col) => (
                            <TableHeaderCell key={col}>{col}</TableHeaderCell>
                          ))}
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {rows.map((row, i) => (
                          <TableRow key={i}>
                            {businessColumns.map((col) => (
                              <TableCell key={col} className="font-mono text-xs">
                                {String(row[col] ?? "—")}
                              </TableCell>
                            ))}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                    <details className="text-xs text-slate-500">
                      <summary className="cursor-pointer font-medium text-slate-700">
                        Lineage columns ({lineageColumns.length})
                      </summary>
                      <Table>
                        <TableHead>
                          <TableRow>
                            {lineageColumns.map((col) => (
                              <TableHeaderCell key={col}>{col}</TableHeaderCell>
                            ))}
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {rows.map((row, i) => (
                            <TableRow key={i}>
                              {lineageColumns.map((col) => (
                                <TableCell key={col} className="font-mono text-xs">
                                  {String(row[col] ?? "—")}
                                </TableCell>
                              ))}
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </details>
                  </div>
                )}
              </CardContent>
            </Card>
          ) : null}
        </>
      )}
    </div>
  );
}
