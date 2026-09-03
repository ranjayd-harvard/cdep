import { randomBytes, createHash } from "node:crypto";
import { getDb } from "@/lib/mongodb";

interface DownloadTokenDocument {
  /** SHA-256 hash of the raw token — a database read alone can't forge a link, same idiom as `auth-tokens.ts`. */
  _id: string;
  tenantId: string;
  fileId: string;
  expires: Date;
}

function hashToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

let indexesEnsured = false;

async function ensureIndexes(): Promise<void> {
  if (indexesEnsured) {
    return;
  }
  const db = await getDb();
  await db.collection<DownloadTokenDocument>("downloadTokens").createIndex({ expires: 1 }, { expireAfterSeconds: 0 });
  indexesEnsured = true;
}

/**
 * Issues a short-lived download link token, bound to the exact tenant and
 * file it was minted for. Unlike `auth-tokens.ts`'s tokens, this one is
 * NOT deleted on first read — a browser may retry or resume a download —
 * it simply expires via the Mongo TTL index above.
 */
export async function createDownloadToken(tenantId: string, fileId: string, ttlMs: number): Promise<string> {
  await ensureIndexes();
  const rawToken = randomBytes(32).toString("hex");
  const db = await getDb();
  await db.collection<DownloadTokenDocument>("downloadTokens").insertOne({
    _id: hashToken(rawToken),
    tenantId,
    fileId,
    expires: new Date(Date.now() + ttlMs),
  });
  return rawToken;
}

/**
 * A token only authorizes the exact `fileId`/`tenantId` it was issued
 * for — a token minted for one file's download link cannot be replayed
 * against another file's path, even within the same tenant and before it
 * expires.
 */
export async function verifyDownloadToken(rawToken: string, fileId: string, tenantId: string): Promise<boolean> {
  const db = await getDb();
  const doc = await db.collection<DownloadTokenDocument>("downloadTokens").findOne({ _id: hashToken(rawToken) });
  if (!doc) {
    return false;
  }
  return doc.expires.getTime() >= Date.now() && doc.fileId === fileId && doc.tenantId === tenantId;
}
