import crypto from "node:crypto";
import { AppError } from "../common/errors/app-error.js";

// Opaque, integrity-protected cursor (spec §8.8). Binds to tenant, product,
// product version, sort order, and a fingerprint of the applied filters —
// so a cursor minted for Tenant A, or for a different filter/sort
// combination, fails signature/shape verification for anyone else,
// including Tenant A itself if it changes filters mid-pagination.
export interface CursorPayload {
  organizationId: string;
  tenantId: string;
  productId: string;
  productVersion: string;
  sort: string[];
  filterFingerprint: string;
  lastValues: Record<string, string>;
}

function sign(payloadJson: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(payloadJson).digest("base64url");
}

export function filterFingerprint(filters: Record<string, string | undefined>): string {
  const sortedEntries = Object.entries(filters)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  return crypto.createHash("sha256").update(JSON.stringify(sortedEntries)).digest("hex");
}

export function encodeCursor(payload: CursorPayload, secret: string): string {
  const payloadJson = JSON.stringify(payload);
  const payloadB64 = Buffer.from(payloadJson, "utf8").toString("base64url");
  const signature = sign(payloadJson, secret);
  return `${payloadB64}.${signature}`;
}

// Verifies signature integrity only. Callers MUST additionally check the
// decoded payload's tenant/product/version/sort/filterFingerprint against
// the current request (see query-engine.ts) — this function alone does not
// know what request it's being used in.
export function decodeCursor(raw: string, secret: string): CursorPayload {
  const parts = raw.split(".");
  if (parts.length !== 2) {
    throw new AppError("INVALID_CURSOR", "Cursor is malformed.");
  }
  const [payloadB64, signature] = parts as [string, string];

  let payloadJson: string;
  try {
    payloadJson = Buffer.from(payloadB64, "base64url").toString("utf8");
  } catch {
    throw new AppError("INVALID_CURSOR", "Cursor is malformed.");
  }

  const expectedSignature = sign(payloadJson, secret);
  const providedBuf = Buffer.from(signature, "utf8");
  const expectedBuf = Buffer.from(expectedSignature, "utf8");
  if (providedBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(providedBuf, expectedBuf)) {
    throw new AppError("INVALID_CURSOR", "Cursor signature is invalid.");
  }

  try {
    const parsed = JSON.parse(payloadJson) as CursorPayload;
    if (
      typeof parsed.organizationId !== "string" ||
      typeof parsed.tenantId !== "string" ||
      typeof parsed.productId !== "string" ||
      typeof parsed.productVersion !== "string" ||
      !Array.isArray(parsed.sort) ||
      typeof parsed.filterFingerprint !== "string" ||
      typeof parsed.lastValues !== "object"
    ) {
      throw new Error("shape mismatch");
    }
    return parsed;
  } catch {
    throw new AppError("INVALID_CURSOR", "Cursor payload is malformed.");
  }
}
