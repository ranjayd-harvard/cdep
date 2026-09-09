"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { Button, Modal, Select } from "@/components/ui";
import type { DataProduct, Organization } from "@/models";
import { grantEntitlementAction, type ActionState } from "./actions";

const INITIAL_STATE: ActionState = {};

export interface TenantOption {
  id: string;
  displayName: string;
}

export interface GrantEntitlementModalProps {
  open: boolean;
  onClose: () => void;
  organizations: Organization[];
  dataProducts: DataProduct[];
  /** Loads (or returns already-loaded) tenants for an organization id, via the graph API. */
  loadTenants: (organizationId: string) => Promise<TenantOption[]>;
  defaultOrganizationId?: string;
  defaultTenantId?: string;
  onGranted: (tenantId: string) => void;
}

export function GrantEntitlementModal({
  open,
  onClose,
  organizations,
  dataProducts,
  loadTenants,
  defaultOrganizationId,
  defaultTenantId,
  onGranted,
}: GrantEntitlementModalProps) {
  const [organizationId, setOrganizationId] = useState(defaultOrganizationId ?? organizations[0]?.id ?? "");
  const [tenants, setTenants] = useState<TenantOption[]>([]);
  const [tenantId, setTenantId] = useState(defaultTenantId ?? "");

  useEffect(() => {
    if (!open || !organizationId) return;
    let cancelled = false;
    loadTenants(organizationId).then((loaded) => {
      if (!cancelled) {
        setTenants(loaded);
        setTenantId((current) => (loaded.some((t) => t.id === current) ? current : (loaded[0]?.id ?? "")));
      }
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, organizationId]);

  const [state, formAction, pending] = useActionState(async (prevState: ActionState, formData: FormData) => {
    const result = await grantEntitlementAction(prevState, formData);
    if (result.success) {
      onGranted(tenantId);
      onClose();
    }
    return result;
  }, INITIAL_STATE);

  const organizationOptions = useMemo(
    () => organizations.map((org) => ({ label: org.displayName, value: org.id })),
    [organizations],
  );
  const tenantOptions = useMemo(() => tenants.map((tenant) => ({ label: tenant.displayName, value: tenant.id })), [tenants]);
  const dataProductOptions = useMemo(
    () => dataProducts.map((dp) => ({ label: `${dp.displayName} (${dp.status})`, value: dp.id })),
    [dataProducts],
  );

  return (
    <Modal open={open} onClose={onClose} title="Grant Data Product Access">
      <form action={formAction} className="flex flex-col gap-3">
        {state.error ? <p className="text-xs text-red-600">{state.error}</p> : null}

        <Select
          label="Organization"
          options={organizationOptions}
          value={organizationId}
          onChange={(event) => setOrganizationId(event.target.value)}
        />
        <Select
          label="Tenant"
          name="tenantId"
          options={tenantOptions.length > 0 ? tenantOptions : [{ label: "No tenants", value: "" }]}
          value={tenantId}
          onChange={(event) => setTenantId(event.target.value)}
        />
        <Select label="Data Product" name="dataProductId" options={dataProductOptions} />
        <div>
          <label className="text-sm font-medium text-slate-700" htmlFor="validUntil">
            Valid until
          </label>
          <input
            id="validUntil"
            name="validUntil"
            type="date"
            className="mt-1.5 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-900/10"
          />
          <p className="mt-1 text-xs text-slate-500">Leave blank for no expiration.</p>
        </div>

        <div className="mt-2 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending || !tenantId}>
            {pending ? "Granting…" : "Grant Access"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
