import { GitBranch } from "lucide-react";
import Link from "next/link";
import { services } from "@/services";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  Input,
  PageHeader,
  StatusBadge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@/components/ui";
import { formatDateTime } from "@/lib/utils";
import {
  activateVersionAction,
  approveVersionAction,
  createMigrationAction,
  deprecateVersionAction,
  executeMigrationAction,
  grantBetaOptInAction,
  retireVersionAction,
  rollbackVersionAction,
} from "./actions";

export default async function AdminCatalogPage({
  searchParams,
}: {
  searchParams: Promise<{ productId?: string; impactVersion?: string; against?: string; actionError?: string; actionSuccess?: string; actionBlockers?: string }>;
}) {
  const { productId, impactVersion, against, actionError, actionSuccess, actionBlockers } = await searchParams;

  const productsResult = await services.productVersioningAdmin.listProducts();

  if (!productsResult.available) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Product Versions" description="Phase 10 — version lifecycle, compatibility, retirement, rollback, and migrations." />
        <Card>
          <CardContent>
            <EmptyState icon={GitBranch} title="Catalog service not configured" description="Set CATALOG_SERVICE_URL to enable this page." />
          </CardContent>
        </Card>
      </div>
    );
  }

  const products = productsResult.items;
  const selectedProductId = productId ?? products[0]?.dataProductId;

  const [versionsResult, migrationsResult] = selectedProductId
    ? await Promise.all([
        services.productVersioningAdmin.listVersions(selectedProductId),
        services.productVersioningAdmin.listMigrations(selectedProductId),
      ])
    : [{ available: false, items: [] }, { available: false, items: [] }];

  const impact =
    selectedProductId && impactVersion
      ? await services.productVersioningAdmin.getImpact(selectedProductId, impactVersion, against || undefined)
      : null;

  const versions = versionsResult.items;
  const activeVersion = versions.find((v) => v.lifecycleStatus === "ACTIVE");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Product Versions" description="Phase 10 — version lifecycle, compatibility, retirement, rollback, and migrations." />

      {actionSuccess ? (
        <div className="rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">{actionSuccess}</div>
      ) : null}
      {actionError ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <div className="font-medium">{actionError}</div>
          {actionBlockers ? <div className="mt-1 text-xs">{actionBlockers}</div> : null}
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Data Products</CardTitle>
        </CardHeader>
        <CardContent>
          {products.length === 0 ? (
            <EmptyState icon={GitBranch} title="No Data Products registered in Catalog yet" />
          ) : (
            <div className="flex flex-wrap gap-2">
              {products.map((p) => (
                <Link
                  key={p.dataProductId}
                  href={`/admin/catalog?productId=${encodeURIComponent(p.dataProductId)}`}
                  className={`rounded-md border px-3 py-1.5 text-sm font-medium ${
                    p.dataProductId === selectedProductId
                      ? "border-slate-900 bg-slate-900 text-white"
                      : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  {p.name}
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {!selectedProductId ? null : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Versions — {selectedProductId}</CardTitle>
            </CardHeader>
            <CardContent>
              {versions.length === 0 ? (
                <EmptyState icon={GitBranch} title="No versions registered yet" />
              ) : (
                <Table>
                  <TableHead>
                    <TableRow>
                      <TableHeaderCell>Version</TableHeaderCell>
                      <TableHeaderCell>Status</TableHeaderCell>
                      <TableHeaderCell>Compatibility</TableHeaderCell>
                      <TableHeaderCell>Lineage</TableHeaderCell>
                      <TableHeaderCell>Grace period</TableHeaderCell>
                      <TableHeaderCell>Actions</TableHeaderCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {versions.map((v) => (
                      <TableRow key={v.version}>
                        <TableCell>
                          <div className="font-medium text-slate-900">{v.version}</div>
                          <div className="text-xs text-slate-500">{v.activatedAt ? `released ${formatDateTime(v.activatedAt)}` : "—"}</div>
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={v.lifecycleStatus} />
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={v.compatibilityType} />
                          {v.migrationRequired ? <div className="mt-1 text-xs text-amber-700">migration required</div> : null}
                        </TableCell>
                        <TableCell className="text-xs text-slate-500">
                          {v.predecessorVersion ? <div>← {v.predecessorVersion}</div> : null}
                          {v.successorVersion ? <div>→ {v.successorVersion}</div> : null}
                        </TableCell>
                        <TableCell className="text-xs text-slate-500">{v.gracePeriodEnd ? formatDateTime(v.gracePeriodEnd) : "—"}</TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-2">
                            {v.lifecycleStatus === "DRAFT" ? (
                              <>
                                <form action={activateVersionAction} className="flex gap-1">
                                  <input type="hidden" name="productId" value={selectedProductId} />
                                  <input type="hidden" name="version" value={v.version} />
                                  <input type="hidden" name="targetStatus" value="ACTIVE" />
                                  <Button type="submit" size="sm">
                                    Activate
                                  </Button>
                                </form>
                                <form action={activateVersionAction} className="flex gap-1">
                                  <input type="hidden" name="productId" value={selectedProductId} />
                                  <input type="hidden" name="version" value={v.version} />
                                  <input type="hidden" name="targetStatus" value="BETA" />
                                  <Button type="submit" size="sm" variant="secondary">
                                    Promote to Beta
                                  </Button>
                                </form>
                                <form action={approveVersionAction} className="flex items-center gap-1">
                                  <input type="hidden" name="productId" value={selectedProductId} />
                                  <input type="hidden" name="version" value={v.version} />
                                  <Input name="reason" placeholder="Approval reason" className="h-8 w-40 text-xs" />
                                  <Button type="submit" size="sm" variant="secondary">
                                    Approve
                                  </Button>
                                </form>
                              </>
                            ) : null}

                            {v.lifecycleStatus === "BETA" ? (
                              <>
                                <form action={activateVersionAction} className="flex gap-1">
                                  <input type="hidden" name="productId" value={selectedProductId} />
                                  <input type="hidden" name="version" value={v.version} />
                                  <input type="hidden" name="targetStatus" value="ACTIVE" />
                                  <Button type="submit" size="sm">
                                    Activate
                                  </Button>
                                </form>
                                <form action={retireVersionAction} className="flex gap-1">
                                  <input type="hidden" name="productId" value={selectedProductId} />
                                  <input type="hidden" name="version" value={v.version} />
                                  <Button type="submit" size="sm" variant="danger">
                                    Retire
                                  </Button>
                                </form>
                                <form action={grantBetaOptInAction} className="flex flex-col gap-1">
                                  <input type="hidden" name="productId" value={selectedProductId} />
                                  <input type="hidden" name="version" value={v.version} />
                                  <Input name="organizationId" placeholder="organizationId" className="h-8 w-40 text-xs" />
                                  <Input name="tenantId" placeholder="tenantId" className="h-8 w-40 text-xs" />
                                  <Button type="submit" size="sm" variant="secondary">
                                    Grant beta opt-in
                                  </Button>
                                </form>
                              </>
                            ) : null}

                            {v.lifecycleStatus === "ACTIVE" ? (
                              <form action={deprecateVersionAction} className="flex flex-col gap-1">
                                <input type="hidden" name="productId" value={selectedProductId} />
                                <input type="hidden" name="version" value={v.version} />
                                <Input name="gracePeriodDays" placeholder="grace period days (90)" className="h-8 w-40 text-xs" />
                                <Input name="replacementVersion" placeholder="successor version" className="h-8 w-40 text-xs" />
                                <Button type="submit" size="sm" variant="secondary">
                                  Deprecate
                                </Button>
                              </form>
                            ) : null}

                            {v.lifecycleStatus === "DEPRECATED" ? (
                              <>
                                <form action={retireVersionAction} className="flex flex-col gap-1">
                                  <input type="hidden" name="productId" value={selectedProductId} />
                                  <input type="hidden" name="version" value={v.version} />
                                  <Input name="reason" placeholder="reason (required if forced)" className="h-8 w-40 text-xs" />
                                  <label className="flex items-center gap-1 text-xs text-slate-600">
                                    <input type="checkbox" name="force" /> force override
                                  </label>
                                  <Button type="submit" size="sm" variant="danger">
                                    Retire
                                  </Button>
                                </form>
                                <form action={rollbackVersionAction} className="flex gap-1">
                                  <input type="hidden" name="productId" value={selectedProductId} />
                                  <input type="hidden" name="version" value={v.version} />
                                  <Button type="submit" size="sm" variant="secondary">
                                    Rollback to this
                                  </Button>
                                </form>
                              </>
                            ) : null}

                            {v.lifecycleStatus !== "RETIRED" ? (
                              <Link
                                href={`/admin/catalog?productId=${encodeURIComponent(selectedProductId)}&impactVersion=${encodeURIComponent(v.version)}${activeVersion ? `&against=${encodeURIComponent(activeVersion.version)}` : ""}`}
                                className="text-xs font-medium text-slate-600 underline"
                              >
                                View impact vs. current ACTIVE
                              </Link>
                            ) : null}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {impact ? (
            <Card>
              <CardHeader>
                <CardTitle>
                  Impact: {impact.fromVersion} → {impact.toVersion}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="grid grid-cols-2 gap-4 sm:grid-cols-5">
                  <div>
                    <dt className="text-xs text-slate-500">Subscribers</dt>
                    <dd className="text-lg font-semibold text-slate-900">{impact.subscriberCount}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">Resolving to {impact.fromVersion}</dt>
                    <dd className="text-lg font-semibold text-slate-900">{impact.automaticallyCompatible}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">Resolving to {impact.toVersion}</dt>
                    <dd className="text-lg font-semibold text-slate-900">{impact.resolvesToTo}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">Pinned (EXACT)</dt>
                    <dd className="text-lg font-semibold text-slate-900">{impact.pinned}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">Requires explicit migration</dt>
                    <dd className="text-lg font-semibold text-amber-700">{impact.requiresExplicitMigration}</dd>
                  </div>
                </dl>
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>Migration plans</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {migrationsResult.items.length === 0 ? (
                <EmptyState icon={GitBranch} title="No migration plans yet" />
              ) : (
                <Table>
                  <TableHead>
                    <TableRow>
                      <TableHeaderCell>From → To</TableHeaderCell>
                      <TableHeaderCell>Compatibility</TableHeaderCell>
                      <TableHeaderCell>Status</TableHeaderCell>
                      <TableHeaderCell>Reason</TableHeaderCell>
                      <TableHeaderCell>Created</TableHeaderCell>
                      <TableHeaderCell>Actions</TableHeaderCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {migrationsResult.items.map((m) => (
                      <TableRow key={m.migrationId}>
                        <TableCell className="font-medium text-slate-900">
                          {m.fromVersion} → {m.toVersion}
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={m.compatibility} />
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={m.status} />
                        </TableCell>
                        <TableCell className="max-w-xs truncate text-xs text-slate-600">{m.reason ?? "—"}</TableCell>
                        <TableCell className="text-xs text-slate-500">{formatDateTime(m.createdAt)}</TableCell>
                        <TableCell>
                          {m.status === "PLANNED" || m.status === "IN_PROGRESS" || m.status === "BLOCKED" ? (
                            <form action={executeMigrationAction}>
                              <input type="hidden" name="productId" value={selectedProductId} />
                              <input type="hidden" name="migrationId" value={m.migrationId} />
                              <Button type="submit" size="sm">
                                Execute
                              </Button>
                            </form>
                          ) : (
                            "—"
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}

              <form action={createMigrationAction} className="flex flex-wrap items-end gap-3 border-t border-slate-200 pt-4">
                <input type="hidden" name="productId" value={selectedProductId} />
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium text-slate-700">To version</label>
                  <Input name="toVersion" placeholder="e.g. 1.1.0" className="w-40" required />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium text-slate-700">Reason</label>
                  <Input name="reason" placeholder="Why this migration" className="w-64" />
                </div>
                <Button type="submit">Create migration plan</Button>
              </form>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
