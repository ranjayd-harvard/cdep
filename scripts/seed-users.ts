import { MongoClient } from "mongodb";
import bcrypt from "bcryptjs";
import { MOCK_USERS, MOCK_LOGIN_PASSWORD } from "../src/data/mocks/users";
import { ensureValidatedCollection } from "./ensure-collection";

interface PortalUserDocument {
  _id: string;
  name: string;
  email: string;
  organizationId: string | null;
  tenantId: string | null;
  role: string | null;
  status: string;
  passwordHash: string | null;
  emailVerified: Date | null;
}

const USERS_VALIDATOR = {
  $jsonSchema: {
    bsonType: "object",
    required: ["name", "email"],
    properties: {
      organizationId: {
        bsonType: ["string", "null"],
        description: "Null until the user completes onboarding (see src/app/(auth)/onboarding).",
      },
      tenantId: {
        bsonType: ["string", "null"],
        description: "Null until the user completes onboarding (see src/app/(auth)/onboarding).",
      },
    },
  },
};

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error("MONGODB_URI is not set. Run this with --env-file=.env.local (see package.json).");
  }
  const dbName = process.env.MONGO_DATABASE ?? "portal";

  const client = new MongoClient(uri);
  try {
    await client.connect();
    const db = client.db(dbName);
    await ensureValidatedCollection(db, "users", USERS_VALIDATOR);
    const users = db.collection<PortalUserDocument>("users");

    // Demo accounts share MOCK_LOGIN_PASSWORD ("portal-demo", see README)
    // but are stored as a real bcrypt hash per user and pre-verified, so
    // they exercise the same code path a real signup would.
    const passwordHash = await bcrypt.hash(MOCK_LOGIN_PASSWORD, 12);
    const now = new Date();

    for (const user of MOCK_USERS) {
      await users.updateOne(
        { _id: user.id },
        {
          $set: {
            name: user.name,
            email: user.email.toLowerCase(),
            organizationId: user.organizationId,
            tenantId: user.tenantId,
            role: user.role,
            status: user.status,
            // Re-applied on every run (not $setOnInsert) so accounts
            // seeded before passwordHash/emailVerified existed get
            // upgraded in place instead of being left unable to log in.
            passwordHash,
            emailVerified: now,
            updatedAt: now,
          },
          $setOnInsert: {
            createdAt: now,
          },
        },
        { upsert: true },
      );
    }

    console.log(`Seeded ${MOCK_USERS.length} portal users into "${dbName}.users".`);
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
