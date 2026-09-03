import { randomBytes, createHash } from "node:crypto";
import { getDb } from "@/lib/mongodb";
import { getTenantScopedCollection, type TenantOwnedDocument } from "@/lib/tenant-scoped-collection";
import type { ApiCredential, CreatedApiKey } from "@/models";

const KEY_PREFIX = "cdep_live_";

interface ApiKeyDocument extends TenantOwnedDocument {
  /** SHA-256 hash of the raw secret — doubles as the lookup key for `verifyApiKey`. */
  _id: string;
  label: string;
  maskedKey: string;
  status: ApiCredential["status"];
  createdAt: string;
  createdBy: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

function hashKey(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

function maskSecret(secret: string): string {
  const visibleTail = secret.slice(-4);
  return `${KEY_PREFIX}${"•".repeat(12)}${visibleTail}`;
}

function toCredential(doc: ApiKeyDocument): ApiCredential {
  return {
    id: doc._id,
    label: doc.label,
    maskedKey: doc.maskedKey,
    status: doc.status,
    createdAt: doc.createdAt,
    createdBy: doc.createdBy,
    lastUsedAt: doc.lastUsedAt,
    revokedAt: doc.revokedAt,
  };
}

export async function listApiKeys(tenantId: string): Promise<ApiCredential[]> {
  const db = await getDb();
  const apiKeys = getTenantScopedCollection<ApiKeyDocument>(db, "apiKeys", tenantId);
  const docs = await apiKeys.find().sort({ createdAt: -1 }).toArray();
  return docs.map(toCredential);
}

/**
 * Issues a new API key for the tenant. The raw secret is returned exactly
 * once, here — only its SHA-256 hash is persisted (as the document's
 * `_id`, doubling as the index `verifyApiKey` looks up by), the same
 * one-way pattern `src/lib/auth-tokens.ts` uses for email links.
 */
export async function createApiKey(tenantId: string, label: string, createdBy: string): Promise<CreatedApiKey> {
  const secret = `${KEY_PREFIX}${randomBytes(24).toString("hex")}`;
  const db = await getDb();
  const apiKeys = getTenantScopedCollection<ApiKeyDocument>(db, "apiKeys", tenantId);

  const doc: ApiKeyDocument = {
    _id: hashKey(secret),
    tenantId,
    label,
    maskedKey: maskSecret(secret),
    status: "active",
    createdAt: new Date().toISOString(),
    createdBy,
    lastUsedAt: null,
    revokedAt: null,
  };
  await apiKeys.insertOne(doc);

  return { credential: toCredential(doc), secret };
}

/**
 * Revoked in place rather than deleted, matching the entitlement/tenant
 * status-flip convention — a revoked key stays visible in the list as an
 * audit trail instead of silently disappearing.
 */
export async function revokeApiKey(tenantId: string, keyId: string): Promise<void> {
  const db = await getDb();
  const apiKeys = getTenantScopedCollection<ApiKeyDocument>(db, "apiKeys", tenantId);
  await apiKeys.updateOne({ _id: keyId }, { $set: { status: "revoked", revokedAt: new Date().toISOString() } });
}

/**
 * Resolves a raw API key (as presented in an `Authorization` header by an
 * external upload/download caller) back to the tenant it belongs to.
 * Deliberately bypasses `TenantScopedCollection`, the same way
 * `findOrganizationById` bypasses it for organization lookups — the whole
 * point of this call is to discover the tenant *from* an unscoped
 * credential, so there is no tenantId to scope by yet. Every other read
 * or write of `apiKeys` goes through the tenant-scoped path above.
 */
export async function verifyApiKey(secret: string): Promise<{ tenantId: string; keyId: string } | null> {
  const db = await getDb();
  const doc = await db.collection<ApiKeyDocument>("apiKeys").findOne({ _id: hashKey(secret) });
  if (!doc || doc.status !== "active") {
    return null;
  }

  await db
    .collection<ApiKeyDocument>("apiKeys")
    .updateOne({ _id: doc._id }, { $set: { lastUsedAt: new Date().toISOString() } });

  return { tenantId: doc.tenantId, keyId: doc._id };
}
