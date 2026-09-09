import { randomBytes } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { MongoClient } from "mongodb";
import bcrypt from "bcryptjs";
import { slugify } from "../src/lib/utils";
import { UserRole, PortalUserStatus } from "../src/models";

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
  createdAt: Date;
  updatedAt: Date;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;

/**
 * Bootstraps the very first SUPERUSER on a new platform instance. Every
 * other account now depends on one existing — org creation moved behind
 * `requireSuperuserContext` (see `src/app/admin/organizations/actions.ts`),
 * so there's no in-app path to create the first one. Run once per
 * environment via `npm run create-superuser` (add `--` then flags, or
 * omit them to be prompted); safe to re-run against the same email to
 * rotate that superuser's password later.
 */
function parseArgs(argv: string[]): { email?: string; name?: string; password?: string; force: boolean } {
  const result: { email?: string; name?: string; password?: string; force: boolean } = { force: false };
  for (const arg of argv) {
    if (arg === "--force") {
      result.force = true;
    } else if (arg.startsWith("--email=")) {
      result.email = arg.slice("--email=".length);
    } else if (arg.startsWith("--name=")) {
      result.name = arg.slice("--name=".length);
    } else if (arg.startsWith("--password=")) {
      result.password = arg.slice("--password=".length);
    }
  }
  return result;
}

async function promptText(question: string): Promise<string> {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

/**
 * Reads a line from stdin without echoing it back, so a password typed
 * at the terminal doesn't end up visible on screen or in a scrollback
 * buffer. Falls back to normal (visible) input when stdin isn't a TTY
 * (e.g. piped input in CI) since raw mode isn't available there.
 */
async function promptHidden(question: string): Promise<string> {
  if (!stdin.isTTY) {
    return promptText(question);
  }

  stdout.write(question);
  return new Promise((resolve) => {
    let value = "";
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");

    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === "\n" || char === "\r") {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.removeListener("data", onData);
          stdout.write("\n");
          resolve(value);
          return;
        }
        if (char === "") {
          // Ctrl+C
          stdout.write("\n");
          process.exit(130);
        }
        if (char === "" || char === "\b") {
          // Backspace
          value = value.slice(0, -1);
          continue;
        }
        value += char;
      }
    };
    stdin.on("data", onData);
  });
}

async function resolveCredentials(
  args: ReturnType<typeof parseArgs>,
): Promise<{ email: string; name: string; password: string }> {
  let email = args.email?.trim().toLowerCase() ?? "";
  while (!EMAIL_PATTERN.test(email)) {
    email = (await promptText("Superuser email: ")).trim().toLowerCase();
  }

  let name = args.name?.trim() ?? "";
  while (!name) {
    name = await promptText("Superuser name: ");
  }

  let password = args.password ?? process.env.SUPERUSER_PASSWORD ?? "";
  if (password && password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
  while (!password) {
    const candidate = await promptHidden(`Password (min ${MIN_PASSWORD_LENGTH} chars): `);
    if (candidate.length < MIN_PASSWORD_LENGTH) {
      console.error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      continue;
    }
    const confirmation = await promptHidden("Confirm password: ");
    if (candidate !== confirmation) {
      console.error("Passwords didn't match — try again.");
      continue;
    }
    password = candidate;
  }

  return { email, name, password };
}

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error("MONGODB_URI is not set. Run this with --env-file=.env.local (see package.json).");
  }
  const dbName = process.env.MONGO_DATABASE ?? "portal";
  const args = parseArgs(process.argv.slice(2));

  const { email, name, password } = await resolveCredentials(args);

  const client = new MongoClient(uri);
  try {
    await client.connect();
    const users = client.db(dbName).collection<PortalUserDocument>("users");

    const existing = await users.findOne({ email });
    if (existing && existing.role !== UserRole.SUPERUSER && !args.force) {
      console.error(
        `"${email}" already exists as ${existing.role ?? "an org-less account"}` +
          `${existing.organizationId ? ` in organization "${existing.organizationId}"` : ""}. ` +
          `Promoting it to SUPERUSER detaches it from that organization and resets its password. ` +
          `Re-run with --force to proceed anyway.`,
      );
      process.exitCode = 1;
      return;
    }

    const now = new Date();
    const passwordHash = await bcrypt.hash(password, 12);
    await users.updateOne(
      { email },
      {
        $set: {
          name,
          email,
          organizationId: null,
          tenantId: null,
          role: UserRole.SUPERUSER,
          status: PortalUserStatus.ACTIVE,
          passwordHash,
          emailVerified: now,
          updatedAt: now,
        },
        $setOnInsert: {
          _id: `user-${slugify(name) || "superuser"}-${randomBytes(3).toString("hex")}`,
          createdAt: now,
        },
      },
      { upsert: true },
    );

    console.log(`Superuser "${email}" is ready — sign in at /login.`);
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
