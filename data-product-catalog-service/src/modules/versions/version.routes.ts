import type { FastifyInstance } from "fastify";
import { requireInternalAuth } from "../../auth/auth.middleware.js";
import { getRequestContext } from "../../auth/authorization.js";
import { AppError } from "../../common/errors/app-error.js";
import { activateVersion, deprecateVersion, retireVersion, rollbackVersion } from "../lifecycle/lifecycle.service.js";
import { findProduct } from "../products/product.repository.js";
import { findVersion, findActiveVersion, listVersions } from "./version.repository.js";
import { getApiContract, getCustomerVersionDetail, listCustomerVersions } from "./version.service.js";
import { evaluateCompatibility } from "../compatibility/evaluate-compatibility.service.js";
import { approveVersion } from "../approvals/approval.service.js";
import { grantBetaOptIn } from "../beta-access/beta-opt-in.service.js";
import { computeImpact } from "../impact-analysis/impact-analysis.service.js";
import { withTransaction } from "../../database/transaction.js";

export async function versionRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/v1/data-products/:productId/versions",
    {
      schema: {
        tags: ["data-products"],
        summary: "Customer-safe version history (spec §27/§55) — no internal registration actors or Git paths.",
        params: { type: "object", properties: { productId: { type: "string" } } },
      },
    },
    async (request, reply) => {
      const { productId } = request.params as { productId: string };
      const items = await listCustomerVersions(productId);
      reply.code(200).send({ items });
    },
  );

  app.get(
    "/v1/data-products/:productId/versions/:version",
    {
      schema: {
        tags: ["data-products"],
        summary: "Customer-safe detail for one version (spec §27).",
        params: { type: "object", properties: { productId: { type: "string" }, version: { type: "string" } } },
      },
    },
    async (request, reply) => {
      const { productId, version } = request.params as { productId: string; version: string };
      const detail = await getCustomerVersionDetail(productId, version);
      reply.code(200).send(detail);
    },
  );

  // ---- internal/v1 ----------------------------------------------------

  // Admin-console-facing: unlike the customer-safe listing above, this
  // includes every lifecycle status (DRAFT/BETA included) and every
  // internal Phase 10 field — backs the /admin/catalog console, which
  // needs to see and act on not-yet-published versions.
  app.get(
    "/internal/v1/data-products/:productId/versions",
    {
      preHandler: [requireInternalAuth()],
      schema: {
        tags: ["internal", "data-products"],
        summary: "Full internal version history for a Data Product, every lifecycle status included (Phase 10 admin console).",
        params: { type: "object", properties: { productId: { type: "string" } } },
      },
    },
    async (request, reply) => {
      const { productId } = request.params as { productId: string };
      const product = await findProduct(productId);
      if (!product) {
        throw new AppError("PRODUCT_NOT_FOUND", `Data Product '${productId}' was not found.`);
      }
      const items = await listVersions(productId);
      reply.code(200).send({
        items: items.map((v) => ({
          version: v.version,
          lifecycle_status: v.lifecycle_status,
          compatibility_type: v.compatibility_type,
          breaking_change: v.breaking_change,
          migration_required: v.migration_required,
          predecessor_version: v.predecessor_version,
          successor_version: v.successor_version,
          grace_period_end: v.grace_period_end,
          activated_at: v.activated_at,
          effective_from: v.effective_from,
          deprecated_at: v.deprecated_at,
          retired_at: v.retired_at,
          created_at: v.created_at,
        })),
      });
    },
  );

  app.get(
    "/internal/v1/data-products/:productId/active-version",
    {
      preHandler: [requireInternalAuth()],
      schema: {
        tags: ["internal", "data-products"],
        summary: "Resolve the ACTIVE version for a Data Product (spec §29) — the common downstream dependency.",
        params: { type: "object", properties: { productId: { type: "string" } } },
      },
    },
    async (request, reply) => {
      const { productId } = request.params as { productId: string };
      const product = await findProduct(productId);
      if (!product || !product.current_active_version) {
        throw new AppError("VERSION_NOT_FOUND", `'${productId}' has no ACTIVE version.`);
      }
      const version = await findVersion(productId, product.current_active_version);
      if (!version) {
        throw new AppError("VERSION_NOT_FOUND", `'${productId}' has no ACTIVE version.`);
      }
      reply.code(200).send({
        dataProductId: productId,
        version: version.version,
        contractVersion: version.contract_version,
        status: version.lifecycle_status,
      });
    },
  );

  // Phase-8-facing (data-product-api-service): the single source of truth
  // for what an API-delivered version may be queried by / must return.
  // Query-string (not :productId/:version params) because this sits
  // alongside the other /internal/v1/versions/... resources rather than
  // under /data-products/:productId, matching how data-product-api-service
  // already knows dataProductId+version as plain resolved values, not path
  // segments of *this* service's URL space.
  app.get(
    "/internal/v1/versions/api-contract",
    {
      preHandler: [requireInternalAuth()],
      schema: {
        tags: ["internal", "versions"],
        summary: "Resolve the Contract-driven API query policy for one Data Product Version (spec §8.2).",
        querystring: {
          type: "object",
          required: ["data_product_id", "version"],
          properties: { data_product_id: { type: "string" }, version: { type: "string" } },
        },
      },
    },
    async (request, reply) => {
      const { data_product_id, version } = request.query as { data_product_id: string; version: string };
      const contract = await getApiContract(data_product_id, version);
      reply.code(200).send({
        data_product_id: contract.dataProductId,
        version: contract.version,
        lifecycle_status: contract.lifecycleStatus,
        resource: contract.resource,
        published_fields: contract.publishedFields.map((f) => ({ name: f.name, type: f.type, nullable: f.nullable, masking_policy: f.maskingPolicy })),
        filters: contract.filters,
        sorts: contract.sorts,
        default_sort: contract.defaultSort,
        default_page_size: contract.defaultPageSize,
        max_page_size: contract.maxPageSize,
        max_response_bytes: contract.maxResponseBytes,
        freshness_minutes: contract.freshnessMinutes,
      });
    },
  );

  app.post(
    "/internal/v1/data-products/:productId/versions/:version/activate",
    {
      preHandler: [requireInternalAuth("PRODUCT_ADMIN")],
      schema: {
        tags: ["internal", "data-products"],
        summary: "Activate a version, superseding the prior canonical ACTIVE version (spec §20).",
        params: { type: "object", properties: { productId: { type: "string" }, version: { type: "string" } } },
      },
    },
    async (request, reply) => {
      const { productId, version } = request.params as { productId: string; version: string };
      const body = (request.body ?? {}) as { targetStatus?: "BETA" | "ACTIVE" };
      const actor = getRequestContext(request);
      const updated = await activateVersion(productId, version, actor, { targetStatus: body.targetStatus });
      reply.code(200).send({ dataProductId: productId, version: updated.version, lifecycleStatus: updated.lifecycle_status });
    },
  );

  app.post(
    "/internal/v1/data-products/:productId/versions/:version/deprecate",
    {
      preHandler: [requireInternalAuth("PRODUCT_ADMIN")],
      schema: {
        tags: ["internal", "data-products"],
        summary: "Deprecate a version (spec §56), starting its grace period.",
        params: { type: "object", properties: { productId: { type: "string" }, version: { type: "string" } } },
      },
    },
    async (request, reply) => {
      const { productId, version } = request.params as { productId: string; version: string };
      const body = (request.body ?? {}) as { reason?: string; replacementVersion?: string; gracePeriodDays?: number };
      const actor = getRequestContext(request);
      const updated = await deprecateVersion(productId, version, body, actor);
      reply.code(200).send({ dataProductId: productId, version: updated.version, lifecycleStatus: updated.lifecycle_status });
    },
  );

  app.post(
    "/internal/v1/data-products/:productId/versions/:version/retire",
    {
      preHandler: [requireInternalAuth("PRODUCT_ADMIN")],
      schema: {
        tags: ["internal", "data-products"],
        summary: "Retire a version (spec §57). Retiring the current ACTIVE version requires force=true.",
        params: { type: "object", properties: { productId: { type: "string" }, version: { type: "string" } } },
      },
    },
    async (request, reply) => {
      const { productId, version } = request.params as { productId: string; version: string };
      const body = (request.body ?? {}) as { reason?: string; force?: boolean };
      const actor = getRequestContext(request);
      const updated = await retireVersion(productId, version, body, actor);
      reply.code(200).send({ dataProductId: productId, version: updated.version, lifecycleStatus: updated.lifecycle_status });
    },
  );

  app.post(
    "/internal/v1/data-products/:productId/versions/:version/rollback",
    {
      preHandler: [requireInternalAuth("PLATFORM_ADMIN")],
      schema: {
        tags: ["internal", "data-products"],
        summary: "Emergency rollback: un-supersede the immediately-previous DEPRECATED version (spec §33).",
        params: { type: "object", properties: { productId: { type: "string" }, version: { type: "string" } } },
      },
    },
    async (request, reply) => {
      const { productId, version } = request.params as { productId: string; version: string };
      const body = (request.body ?? {}) as { reason?: string };
      const actor = getRequestContext(request);
      const updated = await rollbackVersion(productId, version, actor, body.reason);
      reply.code(200).send({ dataProductId: productId, version: updated.version, lifecycleStatus: updated.lifecycle_status });
    },
  );

  app.post(
    "/internal/v1/data-products/:productId/versions/:version/evaluate-compatibility",
    {
      preHandler: [requireInternalAuth("CONTRACT_REGISTRAR")],
      schema: {
        tags: ["internal", "data-products"],
        summary: "Dry-run compatibility evaluation against a candidate contract, without creating a version (spec §23).",
        params: { type: "object", properties: { productId: { type: "string" }, version: { type: "string" } } },
      },
    },
    async (request, reply) => {
      const { productId, version } = request.params as { productId: string; version: string };
      const body = (request.body ?? {}) as { contract: unknown };
      const actor = getRequestContext(request);
      const result = await evaluateCompatibility(productId, version, body.contract, actor);
      reply.code(200).send({
        source_version: result.sourceVersion,
        target_version: result.targetVersion,
        compatibility: result.compatibility,
        valid_version_bump: result.validVersionBump,
        changes: result.changes,
      });
    },
  );

  app.post(
    "/internal/v1/data-products/:productId/versions/:version/approve",
    {
      preHandler: [requireInternalAuth("PRODUCT_ADMIN")],
      schema: {
        tags: ["internal", "data-products"],
        summary: "Record an approval for a version's latest compatibility evaluation (spec §24) — required for BREAKING versions before they may leave DRAFT.",
        params: { type: "object", properties: { productId: { type: "string" }, version: { type: "string" } } },
      },
    },
    async (request, reply) => {
      const { productId, version } = request.params as { productId: string; version: string };
      const body = (request.body ?? {}) as { reason?: string };
      const actor = getRequestContext(request);
      const approval = await withTransaction((client) => approveVersion(client, { dataProductId: productId, version, reason: body.reason, actor }));
      reply.code(201).send({
        approval_id: approval.approval_id,
        data_product_id: approval.data_product_id,
        version: approval.version,
        compatibility_level: approval.compatibility_level,
        required: approval.required,
        approved_by: approval.approved_by,
        approved_at: approval.approved_at,
      });
    },
  );

  app.post(
    "/internal/v1/data-products/:productId/versions/:version/beta-opt-in",
    {
      preHandler: [requireInternalAuth("PRODUCT_ADMIN")],
      schema: {
        tags: ["internal", "data-products"],
        summary: "Grant a tenant explicit eligibility to consume a BETA version (spec §11/§18).",
        params: { type: "object", properties: { productId: { type: "string" }, version: { type: "string" } } },
      },
    },
    async (request, reply) => {
      const { productId, version } = request.params as { productId: string; version: string };
      const body = request.body as { organizationId: string; tenantId: string };
      const actor = getRequestContext(request);
      const row = await grantBetaOptIn(productId, version, body, actor);
      reply.code(201).send({
        beta_opt_in_id: row.beta_opt_in_id,
        data_product_version_id: row.data_product_version_id,
        organization_id: row.organization_id,
        tenant_id: row.tenant_id,
        opted_in_at: row.opted_in_at,
      });
    },
  );

  app.get(
    "/internal/v1/data-products/:productId/versions/:version/impact",
    {
      preHandler: [requireInternalAuth()],
      schema: {
        tags: ["internal", "data-products"],
        summary: "Subscriber impact analysis for a version change (spec §26). ?against= defaults to the current ACTIVE version.",
        params: { type: "object", properties: { productId: { type: "string" }, version: { type: "string" } } },
        querystring: { type: "object", properties: { against: { type: "string" } } },
      },
    },
    async (request, reply) => {
      const { productId, version } = request.params as { productId: string; version: string };
      const { against } = request.query as { against?: string };
      let toVersion = against;
      if (!toVersion) {
        const active = await findActiveVersion(productId);
        if (!active) throw new AppError("VERSION_NOT_FOUND", `'${productId}' has no ACTIVE version to compare against.`);
        toVersion = active.version;
      }
      const impact = await computeImpact(productId, version, toVersion);
      reply.code(200).send({
        data_product_id: impact.dataProductId,
        from_version: impact.fromVersion,
        to_version: impact.toVersion,
        subscriber_count: impact.totalSubscriptions,
        automatically_compatible: impact.byResolutionGroup.resolvesToFrom,
        resolves_to_to: impact.byResolutionGroup.resolvesToTo,
        pinned: impact.byResolutionGroup.pinnedToFrom,
        beta_opt_in: impact.byResolutionGroup.betaOptedIn,
        requires_explicit_migration: impact.requiresExplicitAction,
      });
    },
  );
}
