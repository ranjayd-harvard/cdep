import { requireTenantContext } from "@/lib/tenant";
import { canManageEntitlements } from "@/lib/authorization";
import { listDataProducts } from "@/lib/data-product-directory";
import { EntitlementStatus } from "@/models";
import { services } from "@/services";
import {
  PageHeader,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  StatusBadge,
  Button,
  Select,
  UnauthorizedState,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableHeaderCell,
  TableCell,
} from "@/components/ui";
import { formatDateTime } from "@/lib/utils";
import { revokeEntitlement, reactivateEntitlement } from "./entitlement-actions";
import { GrantEntitlementForm } from "./grant-entitlement-form";

export default async function EntitlementsPage({
  searchParams,
}: {
  searchParams: Promise<{ tenantId?: string }>;
}) {
  const tenant = await requireTenantContext();
  if (!canManageEntitlements(tenant.role)) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Entitlements" description="Grant or revoke a tenant's access to data products." />
        <UnauthorizedState description="Only an organization admin can manage entitlements." />
      </div>
    );
  }

  const [orgTenants, catalog] = await Promise.all([
    services.tenants.listTenants(tenant.organizationId),
    listDataProducts(),
  ]);

  const { tenantId: requestedTenantId } = await searchParams;
  const activeTenant =
    orgTenants.find((t) => t.id === requestedTenantId) ??
    orgTenants.find((t) => t.id === tenant.tenantId) ??
    orgTenants[0] ??
    null;

  const entitlements = activeTenant ? await services.entitlements.getEntitlements(activeTenant.id) : [];

  const catalogById = new Map(catalog.map((product) => [product.id, product]));
  const activeDataProductIds = new Set(
    entitlements.filter((e) => e.status === EntitlementStatus.ACTIVE).map((e) => e.dataProductId),
  );
  const grantableOptions = catalog
    .filter((product) => !activeDataProductIds.has(product.id))
    .map((product) => ({ label: `${product.displayName} (${product.domain})`, value: product.id }));

  const tenantOptions = orgTenants.map((t) => ({
    label: `${t.displayName}${t.isDefault ? " (Default)" : ""}`,
    value: t.id,
  }));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Entitlements" description="Grant or revoke a tenant's access to data products." />

      {orgTenants.length > 1 ? (
        <form action="/entitlements" className="flex items-end gap-3">
          <Select label="Tenant" name="tenantId" options={tenantOptions} defaultValue={activeTenant?.id} />
          <Button type="submit" variant="secondary">
            View
          </Button>
        </form>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{activeTenant ? `${activeTenant.displayName}'s entitlements` : "Entitlements"}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {!activeTenant ? (
            <p className="text-sm text-slate-500">No tenant to manage.</p>
          ) : entitlements.length === 0 ? (
            <p className="text-sm text-slate-500">No entitlements yet.</p>
          ) : (
            <Table>
              <TableHead>
                <TableRow>
                  <TableHeaderCell>Data Product</TableHeaderCell>
                  <TableHeaderCell>Domain</TableHeaderCell>
                  <TableHeaderCell>Status</TableHeaderCell>
                  <TableHeaderCell>Granted</TableHeaderCell>
                  <TableHeaderCell>Expires</TableHeaderCell>
                  <TableHeaderCell>
                    <span className="sr-only">Actions</span>
                  </TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {entitlements.map((entitlement) => {
                  const product = catalogById.get(entitlement.dataProductId);
                  const isActive = entitlement.status === EntitlementStatus.ACTIVE;
                  return (
                    <TableRow key={entitlement.id}>
                      <TableCell className="font-medium text-slate-900">
                        {product?.displayName ?? entitlement.dataProductId}
                      </TableCell>
                      <TableCell>{product?.domain ?? "—"}</TableCell>
                      <TableCell>
                        <StatusBadge status={entitlement.status} />
                      </TableCell>
                      <TableCell>{formatDateTime(entitlement.grantedAt)}</TableCell>
                      <TableCell>{entitlement.expiresAt ? formatDateTime(entitlement.expiresAt) : "Never"}</TableCell>
                      <TableCell>
                        {isActive ? (
                          <form action={revokeEntitlement.bind(null, activeTenant.id, entitlement.id)}>
                            <Button type="submit" size="sm" variant="secondary">
                              Revoke
                            </Button>
                          </form>
                        ) : (
                          <form action={reactivateEntitlement.bind(null, activeTenant.id, entitlement.id)}>
                            <Button type="submit" size="sm" variant="secondary">
                              Reactivate
                            </Button>
                          </form>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}

          {activeTenant ? (
            <GrantEntitlementForm tenantId={activeTenant.id} dataProductOptions={grantableOptions} />
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
