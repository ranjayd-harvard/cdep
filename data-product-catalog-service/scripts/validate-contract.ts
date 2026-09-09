// npm run contract:validate -- path/to/contract.yaml
//
// CI entry point (spec §48): loads and structurally validates a contract
// file WITHOUT calling the running Catalog service — this can run in a CI
// job that has no network access to the catalog at all. Exits non-zero on
// any failure so it gates a PR/merge.
import { contractDocumentSchema } from "../src/registration/contract-schema.js";
import { validateContractStructure } from "../src/registration/registration.validator.js";
import { computeContractHash } from "../src/registration/contract-hash.js";
import { loadContractFile } from "./contract-loader.js";

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    // eslint-disable-next-line no-console
    console.error("Usage: npm run contract:validate -- path/to/contract.yaml");
    process.exit(1);
  }

  const raw = await loadContractFile(filePath);
  const parsed = contractDocumentSchema.safeParse(raw);
  if (!parsed.success) {
    // eslint-disable-next-line no-console
    console.error("CONTRACT_INVALID:");
    for (const issue of parsed.error.issues) {
      // eslint-disable-next-line no-console
      console.error(`  - ${issue.path.join(".")}: ${issue.message}`);
    }
    process.exit(1);
  }

  try {
    validateContractStructure(parsed.data);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`CONTRACT_INVALID: ${(err as Error).message}`);
    process.exit(1);
  }

  const hash = computeContractHash(parsed.data);
  // eslint-disable-next-line no-console
  console.log(`Product:  ${parsed.data.metadata.id}`);
  // eslint-disable-next-line no-console
  console.log(`Version:  ${parsed.data.metadata.version}`);
  // eslint-disable-next-line no-console
  console.log(`Hash:     ${hash}`);
  // eslint-disable-next-line no-console
  console.log("Validation: PASSED");
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
