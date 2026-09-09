import type { FastifyInstance } from "fastify";
import { requireInternalAuth } from "../../auth/auth.middleware.js";
import { getRequestContext } from "../../auth/authorization.js";
import { AppError } from "../../common/errors/app-error.js";
import { activateVersion, deprecateVersion, retireVersion } from "../../registration/lifecycle.service.js";
import { findProduct } from "../products/product.repository.js";
import { findVersion } from "./version.repository.js";
import { getApiContract, getCustomerVersionDetail, listCustomerVersions } from "./version.service.js";

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
        published_fields: contract.publishedFields.map((f) => ({ name: f.name, type: f.type, nullable: f.nullable })),
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
      const actor = getRequestContext(request);
      const updated = await activateVersion(productId, version, actor);
      reply.code(200).send({ dataProductId: productId, version: updated.version, lifecycleStatus: updated.lifecycle_status });
    },
  );

  app.post(
    "/internal/v1/data-products/:productId/versions/:version/deprecate",
    {
      preHandler: [requireInternalAuth("PRODUCT_ADMIN")],
      schema: {
        tags: ["internal", "data-products"],
        summary: "Deprecate a version (spec §56).",
        params: { type: "object", properties: { productId: { type: "string" }, version: { type: "string" } } },
      },
    },
    async (request, reply) => {
      const { productId, version } = request.params as { productId: string; version: string };
      const body = (request.body ?? {}) as { reason?: string; replacementVersion?: string };
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
}
