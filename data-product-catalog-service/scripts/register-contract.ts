// npm run contract:register -- path/to/contract.yaml
//
// CI entry point (spec §49): loads the YAML, normalizes it, and calls the
// running Catalog service's registration API over HTTP. Talks to the
// service exactly the way any other CI job / service identity would —
// CATALOG_SERVICE_URL / CATALOG_INTERNAL_API_TOKEN, not direct DB access.
import path from "node:path";
import { contractDocumentSchema } from "../src/registration/contract-schema.js";
import { validateContractStructure } from "../src/registration/registration.validator.js";
import { loadContractFile } from "./contract-loader.js";

const CATALOG_SERVICE_URL = process.env.CATALOG_SERVICE_URL ?? "http://localhost:8092";
const INTERNAL_API_TOKEN = process.env.CATALOG_INTERNAL_API_TOKEN ?? process.env.INTERNAL_API_TOKEN ?? "";

async function main() {
  const filePath = process.argv[2];
  const commit = process.argv[3] ?? process.env.GIT_COMMIT ?? undefined;
  if (!filePath) {
    // eslint-disable-next-line no-console
    console.error("Usage: npm run contract:register -- path/to/contract.yaml [commit-sha]");
    process.exit(1);
  }

  const raw = await loadContractFile(filePath);
  const parsed = contractDocumentSchema.parse(raw);
  validateContractStructure(parsed);

  const format = filePath.endsWith(".json") ? "JSON" : "YAML";
  const body = {
    contract: parsed,
    contractFormat: format,
    source: {
      repository: process.env.GIT_REPOSITORY ?? "data-lakehouse",
      path: path.relative(process.cwd(), filePath),
      commit,
    },
  };

  const headers: Record<string, string> = { "content-type": "application/json" };
  if (INTERNAL_API_TOKEN) {
    headers["x-internal-api-key"] = INTERNAL_API_TOKEN;
    headers["x-actor-type"] = "CI";
    headers["x-actor-id"] = process.env.CI_ACTOR ?? "contract-register-cli";
    headers["x-actor-role"] = "CONTRACT_REGISTRAR";
  }

  const response = await fetch(new URL("/internal/v1/contracts/register", CATALOG_SERVICE_URL), {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  const result = (await response.json()) as {
    dataProductId?: string;
    version?: string;
    compatibility?: string;
    contractHash?: string;
    registration?: string;
    error?: { code: string; message: string };
  };

  if (!response.ok) {
    // eslint-disable-next-line no-console
    console.error(`Registration: FAILED (${result.error?.code ?? response.status})`);
    // eslint-disable-next-line no-console
    console.error(result.error?.message ?? (await response.text().catch(() => "")));
    process.exit(1);
  }

  // eslint-disable-next-line no-console
  console.log(`Product: ${result.dataProductId}`);
  // eslint-disable-next-line no-console
  console.log(`Version: ${result.version}`);
  // eslint-disable-next-line no-console
  console.log(`Compatibility: ${result.compatibility}`);
  // eslint-disable-next-line no-console
  console.log(`Contract Hash: ${result.contractHash}`);
  // eslint-disable-next-line no-console
  console.log(`Registration: ${result.registration === "DUPLICATE" ? "SUCCESS (idempotent replay)" : "SUCCESS"}`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
