import { randomBytes } from "node:crypto";
import { getDb } from "@/lib/mongodb";
import { slugify } from "@/lib/utils";
import { PortalUserStatus, type PortalUser, type UserRole } from "@/models";

export interface AuthUser extends PortalUser {
  passwordHash: string | null;
  emailVerified: Date | null;
}

interface PortalUserDocument {
  _id: string;
  name: string;
  email: string;
  organizationId: string | null;
  tenantId: string | null;
  role: PortalUser["role"];
  status?: PortalUser["status"];
  passwordHash: string | null;
  emailVerified: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

function toAuthUser(doc: PortalUserDocument): AuthUser {
  return {
    id: doc._id,
    name: doc.name,
    email: doc.email,
    organizationId: doc.organizationId,
    tenantId: doc.tenantId,
    role: doc.role,
    // Every document created before `status` existed is implicitly active.
    status: doc.status ?? PortalUserStatus.ACTIVE,
    passwordHash: doc.passwordHash,
    emailVerified: doc.emailVerified,
  };
}

/**
 * The pre-provisioned tenant directory: every account a user can sign in
 * as (via Credentials or Google) must already exist here, keyed by
 * email. Accounts get in either by `scripts/seed-users.ts` or by
 * self-serve signup (`createPortalUser`, see `src/app/(auth)/signup`).
 */
export async function findPortalUserByEmail(email: string): Promise<AuthUser | null> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  const db = await getDb();
  const doc = await db.collection<PortalUserDocument>("users").findOne({ email: normalized });
  return doc ? toAuthUser(doc) : null;
}

/**
 * Used by the `jwt` callback (`src/auth.ts`) to lazily refresh a session
 * token's org/tenant/role once onboarding completes or a join request is
 * approved, without requiring the user to log out and back in.
 */
export async function findPortalUserById(id: string): Promise<AuthUser | null> {
  const db = await getDb();
  const doc = await db.collection<PortalUserDocument>("users").findOne({ _id: id });
  return doc ? toAuthUser(doc) : null;
}

export interface CreatePortalUserInput {
  name: string;
  email: string;
  organizationId: string | null;
  tenantId: string | null;
  role: UserRole | null;
  passwordHash: string | null;
}

/**
 * Creates an account with no organization/tenant assigned yet (both
 * signup and a first-time Google login land here) — the onboarding gate
 * in `src/app/(auth)/onboarding` and `requireTenantContext` (see
 * `src/lib/tenant.ts`) are what route an org-less user to resolve this
 * before they can reach the portal.
 */
export async function createPortalUser(input: CreatePortalUserInput): Promise<AuthUser> {
  const db = await getDb();
  const now = new Date();
  const doc: PortalUserDocument = {
    _id: `user-${slugify(input.name) || "account"}-${randomBytes(3).toString("hex")}`,
    name: input.name,
    email: input.email.trim().toLowerCase(),
    organizationId: input.organizationId,
    tenantId: input.tenantId,
    role: input.role,
    status: PortalUserStatus.ACTIVE,
    passwordHash: input.passwordHash,
    emailVerified: null,
    createdAt: now,
    updatedAt: now,
  };
  await db.collection<PortalUserDocument>("users").insertOne(doc);
  return toAuthUser(doc);
}

/**
 * Assigns a user to an organization + tenant, either because they just
 * created a brand-new organization (immediate CUSTOMER_ADMIN) or because
 * an admin approved their join request (see
 * `src/app/(auth)/onboarding/actions.ts` and
 * `src/app/(portal)/settings/membership-actions.ts`).
 */
export async function assignPortalUserToOrganization(
  userId: string,
  input: { organizationId: string; tenantId: string; role: UserRole },
): Promise<void> {
  const db = await getDb();
  await db.collection<PortalUserDocument>("users").updateOne(
    { _id: userId },
    {
      $set: {
        organizationId: input.organizationId,
        tenantId: input.tenantId,
        role: input.role,
        updatedAt: new Date(),
      },
    },
  );
}

/**
 * Lists every member of an organization — the roster an admin picks from
 * to reassign a member's tenant (see
 * `src/app/(portal)/settings/member-actions.ts`). Not tenant-scoped: an
 * org admin needs to see members across every tenant in their org, not
 * just their own.
 */
export async function listPortalUsersByOrganization(organizationId: string): Promise<AuthUser[]> {
  const db = await getDb();
  const docs = await db.collection<PortalUserDocument>("users").find({ organizationId }).toArray();
  return docs.map(toAuthUser);
}

/**
 * Every account on the platform, across every organization — Admin
 * Console only (`src/app/admin/users`).
 */
export async function listAllPortalUsers(): Promise<AuthUser[]> {
  const db = await getDb();
  const docs = await db.collection<PortalUserDocument>("users").find({}).toArray();
  return docs.map(toAuthUser);
}

/**
 * Admin Console only: reassigns a user's role directly, including
 * granting/revoking platform-root (`SUPERUSER`) — the one place that
 * happens, deliberately kept separate from the per-organization role
 * picker in Settings (see `src/app/(portal)/settings/member-actions.ts`).
 */
export async function setPortalUserRole(userId: string, role: UserRole): Promise<void> {
  const db = await getDb();
  await db.collection<PortalUserDocument>("users").updateOne({ _id: userId }, { $set: { role, updatedAt: new Date() } });
}

/**
 * Admin Console only: suspends/reactivates an account. A suspended user
 * is rejected at sign-in (see the Credentials `authorize` and Google
 * `signIn` callback in `src/auth.ts`) but keeps their existing
 * organization/tenant/role — this is a hold, not a deletion.
 */
export async function setPortalUserStatus(userId: string, status: PortalUser["status"]): Promise<void> {
  const db = await getDb();
  await db
    .collection<PortalUserDocument>("users")
    .updateOne({ _id: userId }, { $set: { status, updatedAt: new Date() } });
}

/**
 * Reassigns which tenant within the user's own organization they're
 * scoped to — either the user switching their own active tenant, or an
 * org admin moving another member (see
 * `src/app/(portal)/settings/tenant-actions.ts` and `member-actions.ts`).
 * Organization and role are untouched; callers are responsible for
 * verifying the target tenant actually belongs to the user's org.
 */
export async function updateUserTenant(userId: string, tenantId: string): Promise<void> {
  const db = await getDb();
  await db
    .collection<PortalUserDocument>("users")
    .updateOne({ _id: userId }, { $set: { tenantId, updatedAt: new Date() } });
}

export async function verifyPortalUserEmail(email: string): Promise<void> {
  const db = await getDb();
  await db
    .collection<PortalUserDocument>("users")
    .updateOne({ email: email.trim().toLowerCase() }, { $set: { emailVerified: new Date(), updatedAt: new Date() } });
}

export async function updatePortalUserPassword(email: string, passwordHash: string): Promise<void> {
  const db = await getDb();
  await db
    .collection<PortalUserDocument>("users")
    .updateOne({ email: email.trim().toLowerCase() }, { $set: { passwordHash, updatedAt: new Date() } });
}
