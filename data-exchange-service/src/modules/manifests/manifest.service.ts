import { buildInboundMetadataKey, buildOutboundMetadataKey } from "../../storage/storage-path-builder.js";
import type { ObjectStorage } from "../../storage/storage.interface.js";
import type { InboundManifest, OutboundManifest } from "./manifest.types.js";

// The manifest is written once and treated as immutable thereafter
// (AGENTS.md section 15) — this service only ever PUTs it during exchange
// completion / publication, and nothing in this codebase re-writes
// manifest.json afterward. Mutable lifecycle state lives in
// validation.json / processing.json instead (section 16).
export async function writeInboundManifest(
  storage: ObjectStorage,
  bucket: string,
  organizationId: string,
  tenantId: string,
  exchangeId: string,
  manifest: InboundManifest,
): Promise<string> {
  const key = buildInboundMetadataKey(organizationId, tenantId, exchangeId, "manifest.json");
  await storage.putObject({
    bucket,
    key,
    body: JSON.stringify(manifest, null, 2),
    contentType: "application/json",
  });
  return key;
}

export async function writeInboundValidationSidecar(
  storage: ObjectStorage,
  bucket: string,
  organizationId: string,
  tenantId: string,
  exchangeId: string,
  validation: unknown,
): Promise<string> {
  const key = buildInboundMetadataKey(organizationId, tenantId, exchangeId, "validation.json");
  await storage.putObject({
    bucket,
    key,
    body: JSON.stringify(validation, null, 2),
    contentType: "application/json",
  });
  return key;
}

export async function writeOutboundManifest(
  storage: ObjectStorage,
  bucket: string,
  organizationId: string,
  tenantId: string,
  exchangeId: string,
  manifest: OutboundManifest,
): Promise<string> {
  const key = buildOutboundMetadataKey(organizationId, tenantId, exchangeId, "manifest.json");
  await storage.putObject({
    bucket,
    key,
    body: JSON.stringify(manifest, null, 2),
    contentType: "application/json",
  });
  return key;
}
