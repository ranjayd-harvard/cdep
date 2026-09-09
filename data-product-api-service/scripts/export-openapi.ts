// Dumps openapi.json (spec §8.14) so future SDKs (Python/TypeScript/Java)
// can be generated from it without needing a live server running.
import { writeFile } from "node:fs/promises";
import { buildApp } from "../src/app.js";

async function main() {
  const app = await buildApp();
  await app.ready();
  const document = app.swagger();
  await writeFile("openapi.json", JSON.stringify(document, null, 2));
  // eslint-disable-next-line no-console
  console.log(`Wrote openapi.json (${Object.keys(document.paths ?? {}).length} paths).`);
  await app.close();
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
