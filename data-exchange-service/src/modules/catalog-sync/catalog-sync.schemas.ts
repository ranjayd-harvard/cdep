import { z } from "zod";

export const organizationParamsSchema = z.object({ organizationId: z.string().min(1) });
export const upsertOrganizationSchema = z.object({ displayName: z.string().min(1) });

export const tenantParamsSchema = z.object({ tenantId: z.string().min(1) });
export const upsertTenantSchema = z.object({
  organizationId: z.string().min(1),
  displayName: z.string().min(1),
});

export const membershipParamsSchema = z.object({ userId: z.string().min(1) });
export const upsertMembershipSchema = z.object({
  organizationId: z.string().min(1),
  tenantId: z.string().min(1),
  role: z.string().min(1),
});

export const dataProductParamsSchema = z.object({ dataProductId: z.string().min(1) });
export const upsertDataProductSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  currentSchemaVersion: z.string().optional(),
});

export const entitlementParamsSchema = z.object({
  tenantId: z.string().min(1),
  dataProductId: z.string().min(1),
});
export const upsertEntitlementSchema = z.object({
  canUpload: z.boolean(),
  canDownload: z.boolean(),
});
