import { MongoClient, type Db } from "mongodb";
import { env } from "@/config/env";

/**
 * Shared MongoDB connection, memoized on `globalThis` so dev-mode module
 * reloads reuse one client instead of opening a new connection pool per
 * request. Not used while NEXT_PUBLIC_USE_MOCK_SERVICES=true — kept thin
 * so the migration path from mocks to real persistence is obvious.
 */
declare global {
  var _mongoClientPromise: Promise<MongoClient> | undefined;
}

function getClientPromise(): Promise<MongoClient> {
  if (!globalThis._mongoClientPromise) {
    globalThis._mongoClientPromise = new MongoClient(env.mongoUri).connect();
  }
  return globalThis._mongoClientPromise;
}

export async function getDb(): Promise<Db> {
  const client = await getClientPromise();
  return client.db(env.mongoDatabase);
}
