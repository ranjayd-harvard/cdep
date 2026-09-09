import { DatasetStatus, DatasetAccessMethod, type Dataset } from "@/models";
import type { DatasetInput } from "@/services/interfaces";

/**
 * Shared form-parsing helper for both "create a dataset under this
 * product" (`./actions.ts`) and catalog-level dataset creation from the
 * Data Relationships explorer (`../../data-relationships/actions.ts`).
 * Lives outside any `"use server"` module because a `"use server"` file's
 * exports must all be Server Actions (async functions) — this is a plain
 * synchronous parser.
 */
export function readDatasetInput(formData: FormData): DatasetInput | { error: string } {
  const name = String(formData.get("name") ?? "").trim();
  const displayName = String(formData.get("displayName") ?? "").trim();
  const status = String(formData.get("status") ?? "") as Dataset["status"];
  const accessMethods = formData.getAll("accessMethods").map(String) as Dataset["accessMethods"];

  if (!name) return { error: "Internal name is required." };
  if (!displayName) return { error: "Display name is required." };
  if (!Object.values(DatasetStatus).includes(status)) return { error: "Choose a valid status." };
  if (accessMethods.some((method) => !Object.values(DatasetAccessMethod).includes(method))) {
    return { error: "Choose a valid access method." };
  }

  let schema: Dataset["schema"];
  let changeHistory: Dataset["documentation"]["changeHistory"];
  try {
    schema = JSON.parse(String(formData.get("schemaJson") ?? "[]"));
    changeHistory = JSON.parse(String(formData.get("changeHistoryJson") ?? "[]"));
  } catch {
    return { error: "Schema or change history data is malformed." };
  }

  return {
    name,
    displayName,
    description: String(formData.get("description") ?? "").trim(),
    domain: String(formData.get("domain") ?? "").trim(),
    owner: String(formData.get("owner") ?? "").trim(),
    version: String(formData.get("version") ?? "").trim(),
    format: String(formData.get("format") ?? "").trim(),
    freshness: String(formData.get("freshness") ?? "").trim(),
    lastUpdated: String(formData.get("lastUpdated") ?? "").trim(),
    status,
    accessMethods,
    schema,
    quality: {
      completeness: Number(formData.get("qualityCompleteness") ?? 0),
      freshness: Number(formData.get("qualityFreshness") ?? 0),
      validity: Number(formData.get("qualityValidity") ?? 0),
      duplicates: Number(formData.get("qualityDuplicates") ?? 0),
    },
    documentation: {
      businessDefinition: String(formData.get("businessDefinition") ?? "").trim(),
      dataContract: String(formData.get("dataContract") ?? "").trim(),
      sla: String(formData.get("sla") ?? "").trim(),
      changeHistory,
    },
    rowLevelPolicy: {
      tenantColumn: String(formData.get("tenantColumn") ?? "").trim(),
      description: String(formData.get("rowLevelPolicyDescription") ?? "").trim(),
    },
  };
}
