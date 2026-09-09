import { readFile } from "node:fs/promises";
import { parse as parseYaml } from "yaml";

// Shared by validate-contract.ts and register-contract.ts so both CLIs load
// a contract file identically. Accepts .yaml/.yml (parsed) or .json
// (parsed) — both end up as the same plain-object shape the Zod schema in
// src/registration/contract-schema.ts expects.
export async function loadContractFile(filePath: string): Promise<unknown> {
  const raw = await readFile(filePath, "utf8");
  if (filePath.endsWith(".json")) {
    return JSON.parse(raw);
  }
  return parseYaml(raw);
}
