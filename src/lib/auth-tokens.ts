import { randomBytes, createHash } from "node:crypto";
import { getDb } from "@/lib/mongodb";

export type AuthTokenPurpose = "verify-email" | "reset-password" | "org-invite";

interface AuthTokenDocument {
  _id: string;
  email: string;
  purpose: AuthTokenPurpose;
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
  await db.collection<AuthTokenDocument>("authTokens").createIndex({ expires: 1 }, { expireAfterSeconds: 0 });
  indexesEnsured = true;
}

/**
 * Issues a single-use, expiring token for the given purpose and returns
 * the raw value to embed in an email link. Only its SHA-256 hash is
 * persisted, so a database read alone can't be used to forge a link.
 */
export async function createAuthToken(email: string, purpose: AuthTokenPurpose, ttlMs: number): Promise<string> {
  await ensureIndexes();
  const rawToken = randomBytes(32).toString("hex");
  const db = await getDb();
  await db.collection<AuthTokenDocument>("authTokens").insertOne({
    _id: hashToken(rawToken),
    email: email.trim().toLowerCase(),
    purpose,
    expires: new Date(Date.now() + ttlMs),
  });
  return rawToken;
}

/**
 * Validates and consumes a token for the given purpose. Tokens are
 * single-use: a valid token is deleted as part of this lookup, so a
 * link can't be replayed. Returns the associated email, or `null` if
 * the token is missing, already used, wrong purpose, or expired.
 */
export async function consumeAuthToken(rawToken: string, purpose: AuthTokenPurpose): Promise<string | null> {
  const db = await getDb();
  const doc = await db
    .collection<AuthTokenDocument>("authTokens")
    .findOneAndDelete({ _id: hashToken(rawToken), purpose });

  if (!doc || doc.expires.getTime() < Date.now()) {
    return null;
  }
  return doc.email;
}
