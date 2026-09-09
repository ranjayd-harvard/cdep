import type { FastifyInstance } from "fastify";
import { requireInternalApiKey } from "../../auth/internal-auth.middleware.js";
import { parseOrThrow } from "../../common/utils/validate.js";
import {
  dataProductParamsSchema,
  entitlementParamsSchema,
  membershipParamsSchema,
  organizationParamsSchema,
  tenantParamsSchema,
  upsertDataProductSchema,
  upsertEntitlementSchema,
  upsertMembershipSchema,
  upsertOrganizationSchema,
  upsertTenantSchema,
} from "./catalog-sync.schemas.js";
import {
  upsertDataProduct,
  upsertEntitlement,
  upsertMembership,
  upsertOrganization,
  upsertTenant,
} from "./catalog-sync.repository.js";

// Real-time counterpart to `scripts/sync-cdep-catalog.ts` — see
// docs/exchange-service-integration.md § "Keeping catalogs in sync". cdep
// calls these, best-effort, right after each catalog-affecting write
// (creating an org/tenant, granting an entitlement, linking a dataset to a
// data product, ...) instead of waiting for the next on-demand
// `npm run sync:cdep` run. Same upsert SQL as that script (via
// `catalog-sync.repository.ts`), same internal-API-key protection as every
// other internal-only surface in this service.
//
// Foreign keys matter here: `exchange.tenants.organization_id` references
// `exchange.organizations`, and `exchange.tenant_data_product_entitlements`
// references both `exchange.tenants` and `exchange.data_products`. Callers
// must push in dependency order (organization, then tenant, then data
// product, then entitlement) — this module does not reorder or batch
// anything on their behalf.
export async function catalogSyncRoutes(app: FastifyInstance): Promise<void> {
  app.put(
    "/internal/v1/catalog/organizations/:organizationId",
    {
      preHandler: [requireInternalApiKey],
      schema: { tags: ["internal"], summary: "Upsert one organization synced from cdep." },
    },
    async (request, reply) => {
      const params = parseOrThrow(organizationParamsSchema, request.params);
      const body = parseOrThrow(upsertOrganizationSchema, request.body);
      await upsertOrganization(params.organizationId, body.displayName);
      reply.code(204).send();
    },
  );

  app.put(
    "/internal/v1/catalog/tenants/:tenantId",
    {
      preHandler: [requireInternalApiKey],
      schema: { tags: ["internal"], summary: "Upsert one tenant synced from cdep." },
    },
    async (request, reply) => {
      const params = parseOrThrow(tenantParamsSchema, request.params);
      const body = parseOrThrow(upsertTenantSchema, request.body);
      await upsertTenant(params.tenantId, body.organizationId, body.displayName);
      reply.code(204).send();
    },
  );

  app.put(
    "/internal/v1/catalog/memberships/:userId",
    {
      preHandler: [requireInternalApiKey],
      schema: { tags: ["internal"], summary: "Upsert one tenant membership synced from cdep." },
    },
    async (request, reply) => {
      const params = parseOrThrow(membershipParamsSchema, request.params);
      const body = parseOrThrow(upsertMembershipSchema, request.body);
      await upsertMembership(params.userId, body.organizationId, body.tenantId, body.role);
      reply.code(204).send();
    },
  );

  app.put(
    "/internal/v1/catalog/data-products/:dataProductId",
    {
      preHandler: [requireInternalApiKey],
      schema: {
        tags: ["internal"],
        summary: "Upsert one data product synced from a cdep Dataset (see 'Catalog model mismatch' in the integration doc).",
      },
    },
    async (request, reply) => {
      const params = parseOrThrow(dataProductParamsSchema, request.params);
      const body = parseOrThrow(upsertDataProductSchema, request.body);
      await upsertDataProduct(params.dataProductId, body.name, body.description ?? "", body.currentSchemaVersion ?? "unknown");
      reply.code(204).send();
    },
  );

  app.put(
    "/internal/v1/catalog/entitlements/:tenantId/:dataProductId",
    {
      preHandler: [requireInternalApiKey],
      schema: { tags: ["internal"], summary: "Upsert one tenant/data-product entitlement synced from cdep." },
    },
    async (request, reply) => {
      const params = parseOrThrow(entitlementParamsSchema, request.params);
      const body = parseOrThrow(upsertEntitlementSchema, request.body);
      await upsertEntitlement(params.tenantId, params.dataProductId, body.canUpload, body.canDownload);
      reply.code(204).send();
    },
  );
}
