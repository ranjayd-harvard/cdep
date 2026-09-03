import type { Db, Document } from "mongodb";

/**
 * Idempotently applies a `$jsonSchema` validator to a collection: creates
 * it with the validator if it doesn't exist yet, or updates the
 * validator via `collMod` if it does. Used to enforce required fields
 * (like `tenantId`) at the database layer, independent of whatever
 * application code happens to run.
 */
export async function ensureValidatedCollection(
  db: Db,
  name: string,
  validator: Document,
): Promise<void> {
  const existing = await db.listCollections({ name }).toArray();
  if (existing.length === 0) {
    await db.createCollection(name, { validator });
  } else {
    await db.command({ collMod: name, validator });
  }
}
