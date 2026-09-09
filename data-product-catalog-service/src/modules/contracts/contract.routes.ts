import type { FastifyInstance } from "fastify";
import { requireInternalAuth } from "../../auth/auth.middleware.js";
import { AppError } from "../../common/errors/app-error.js";
import { findVersion } from "../versions/version.repository.js";
import { findRegisteredContractForVersion } from "./contract.repository.js";

export async function contractRoutes(app: FastifyInstance): Promise<void> {
  // Internal-only (spec §28): Publication Service, future Subscription
  // Service, pipeline validation, operational tools. Returns the
  // authoritative normalized contract verbatim, plus registration
  // provenance — nothing here is filtered for customer consumption.
  app.get(
    "/internal/v1/data-products/:productId/versions/:version/contract",
    {
      preHandler: [requireInternalAuth()],
      schema: {
        tags: ["internal", "contracts"],
        summary: "Fetch the normalized, authoritative contract for one Data Product Version.",
        params: { type: "object", properties: { productId: { type: "string" }, version: { type: "string" } } },
      },
    },
    async (request, reply) => {
      const { productId, version } = request.params as { productId: string; version: string };
      const versionRow = await findVersion(productId, version);
      if (!versionRow) {
        throw new AppError("VERSION_NOT_FOUND", `Version '${version}' of '${productId}' was not found.`);
      }
      const contract = await findRegisteredContractForVersion(versionRow.data_product_version_id);
      if (!contract) {
        throw new AppError("CONTRACT_NOT_FOUND", `No registered contract for '${productId}' version '${version}'.`);
      }
      reply.code(200).send({
        contractId: contract.contract_id,
        dataProductId: productId,
        version,
        contractVersion: contract.contract_version,
        contractFormat: contract.contract_format,
        contractHash: contract.contract_hash,
        contract: contract.contract_body,
        source: {
          repository: contract.source_repository,
          path: contract.source_path,
          commit: contract.source_commit,
        },
        registeredBy: contract.registered_by,
        registeredAt: contract.registered_at,
        status: contract.status,
      });
    },
  );
}
