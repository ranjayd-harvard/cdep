import { describe, expect, it, vi } from "vitest";
import { createFakeDb } from "@/test/fake-mongo";

const { getDbMock } = vi.hoisted(() => ({ getDbMock: vi.fn() }));

vi.mock("@/lib/mongodb", () => ({
  getDb: getDbMock,
}));

import {
  assignPortalUserToOrganization,
  createPortalUser,
  findPortalUserByEmail,
  findPortalUserById,
  listAllPortalUsers,
  listPortalUsersByOrganization,
  setPortalUserRole,
  setPortalUserStatus,
  updatePortalUserPassword,
  updateUserTenant,
  verifyPortalUserEmail,
} from "@/lib/user-directory";
import { PortalUserStatus, UserRole } from "@/models";

function seed(users: Array<Record<string, unknown>> = []) {
  const db = createFakeDb({ users });
  getDbMock.mockResolvedValue(db);
}

describe("user directory", () => {
  it("looks up a user case-insensitively by email", async () => {
    seed([
      {
        _id: "user-1",
        name: "Ada",
        email: "ada@example.com",
        organizationId: "org-1",
        tenantId: "tenant-1",
        role: UserRole.CUSTOMER_ADMIN,
        passwordHash: "hash",
        emailVerified: null,
      },
    ]);

    const user = await findPortalUserByEmail("ADA@EXAMPLE.COM");

    expect(user?.id).toBe("user-1");
  });

  it("returns null for an email that isn't provisioned", async () => {
    seed();

    const user = await findPortalUserByEmail("nobody@example.com");

    expect(user).toBeNull();
  });

  it("creates a new org-less user (signup, pre-onboarding) with no password-hash mutation and emailVerified unset", async () => {
    seed();

    const created = await createPortalUser({
      name: "Grace Hopper",
      email: "Grace@Example.com",
      organizationId: null,
      tenantId: null,
      role: null,
      passwordHash: "hashed-password",
    });

    expect(created.email).toBe("grace@example.com");
    expect(created.organizationId).toBeNull();
    expect(created.tenantId).toBeNull();
    expect(created.role).toBeNull();
    expect(created.emailVerified).toBeNull();
    expect(created.passwordHash).toBe("hashed-password");

    const found = await findPortalUserByEmail("grace@example.com");
    expect(found?.id).toBe(created.id);
  });

  it("finds a user by id", async () => {
    seed([
      {
        _id: "user-1",
        name: "Ada",
        email: "ada@example.com",
        organizationId: "org-1",
        tenantId: "tenant-1",
        role: UserRole.CUSTOMER_ADMIN,
        passwordHash: "hash",
        emailVerified: null,
      },
    ]);

    const user = await findPortalUserById("user-1");
    expect(user?.email).toBe("ada@example.com");

    const missing = await findPortalUserById("user-does-not-exist");
    expect(missing).toBeNull();
  });

  it("assigns an org-less user to an organization/tenant/role, e.g. after onboarding or an approved join request", async () => {
    seed([
      {
        _id: "user-1",
        name: "Grace",
        email: "grace@example.com",
        organizationId: null,
        tenantId: null,
        role: null,
        passwordHash: "hash",
        emailVerified: new Date(),
      },
    ]);

    await assignPortalUserToOrganization("user-1", {
      organizationId: "org-1",
      tenantId: "tenant-1",
      role: UserRole.CUSTOMER_USER,
    });

    const user = await findPortalUserById("user-1");
    expect(user?.organizationId).toBe("org-1");
    expect(user?.tenantId).toBe("tenant-1");
    expect(user?.role).toBe(UserRole.CUSTOMER_USER);
  });

  it("lists only members of the given organization", async () => {
    seed([
      { _id: "user-1", name: "Ada", email: "ada@example.com", organizationId: "org-1", tenantId: "tenant-1", role: UserRole.CUSTOMER_ADMIN, passwordHash: "hash", emailVerified: new Date() },
      { _id: "user-2", name: "Grace", email: "grace@example.com", organizationId: "org-1", tenantId: "tenant-2", role: UserRole.CUSTOMER_USER, passwordHash: "hash", emailVerified: new Date() },
      { _id: "user-3", name: "Sam", email: "sam@example.com", organizationId: "org-2", tenantId: "tenant-3", role: UserRole.CUSTOMER_ADMIN, passwordHash: "hash", emailVerified: new Date() },
    ]);

    const members = await listPortalUsersByOrganization("org-1");

    expect(members.map((m) => m.id).sort()).toEqual(["user-1", "user-2"]);
  });

  it("reassigns a user's tenant without touching their organization or role", async () => {
    seed([
      { _id: "user-1", name: "Ada", email: "ada@example.com", organizationId: "org-1", tenantId: "tenant-1", role: UserRole.CUSTOMER_USER, passwordHash: "hash", emailVerified: new Date() },
    ]);

    await updateUserTenant("user-1", "tenant-2");

    const user = await findPortalUserById("user-1");
    expect(user?.tenantId).toBe("tenant-2");
    expect(user?.organizationId).toBe("org-1");
    expect(user?.role).toBe(UserRole.CUSTOMER_USER);
  });

  it("marks a user's email verified", async () => {
    seed([
      {
        _id: "user-1",
        name: "Ada",
        email: "ada@example.com",
        organizationId: "org-1",
        tenantId: "tenant-1",
        role: UserRole.CUSTOMER_ADMIN,
        passwordHash: "hash",
        emailVerified: null,
      },
    ]);

    await verifyPortalUserEmail("ada@example.com");

    const user = await findPortalUserByEmail("ada@example.com");
    expect(user?.emailVerified).not.toBeNull();
  });

  it("treats a document with no status field as active (pre-existing accounts)", async () => {
    seed([
      { _id: "user-1", name: "Ada", email: "ada@example.com", organizationId: "org-1", tenantId: "tenant-1", role: UserRole.CUSTOMER_ADMIN, passwordHash: "hash", emailVerified: new Date() },
    ]);

    const user = await findPortalUserById("user-1");
    expect(user?.status).toBe(PortalUserStatus.ACTIVE);
  });

  it("lists every account on the platform, across every organization", async () => {
    seed([
      { _id: "user-1", name: "Ada", email: "ada@example.com", organizationId: "org-1", tenantId: "tenant-1", role: UserRole.CUSTOMER_ADMIN, passwordHash: "hash", emailVerified: new Date() },
      { _id: "user-2", name: "Sam", email: "sam@example.com", organizationId: "org-2", tenantId: "tenant-3", role: UserRole.CUSTOMER_ADMIN, passwordHash: "hash", emailVerified: new Date() },
      { _id: "user-3", name: "Nobody", email: "nobody@example.com", organizationId: null, tenantId: null, role: null, passwordHash: "hash", emailVerified: null },
    ]);

    const users = await listAllPortalUsers();

    expect(users.map((u) => u.id).sort()).toEqual(["user-1", "user-2", "user-3"]);
  });

  it("reassigns a user's role directly, including granting SUPERUSER (Admin Console)", async () => {
    seed([
      { _id: "user-1", name: "Ada", email: "ada@example.com", organizationId: "org-1", tenantId: "tenant-1", role: UserRole.CUSTOMER_USER, passwordHash: "hash", emailVerified: new Date() },
    ]);

    await setPortalUserRole("user-1", UserRole.SUPERUSER);

    const user = await findPortalUserById("user-1");
    expect(user?.role).toBe(UserRole.SUPERUSER);
  });

  it("suspends and reactivates an account without touching its role/org/tenant", async () => {
    seed([
      { _id: "user-1", name: "Ada", email: "ada@example.com", organizationId: "org-1", tenantId: "tenant-1", role: UserRole.CUSTOMER_USER, status: "active", passwordHash: "hash", emailVerified: new Date() },
    ]);

    await setPortalUserStatus("user-1", PortalUserStatus.SUSPENDED);
    let user = await findPortalUserById("user-1");
    expect(user?.status).toBe(PortalUserStatus.SUSPENDED);
    expect(user?.role).toBe(UserRole.CUSTOMER_USER);
    expect(user?.organizationId).toBe("org-1");

    await setPortalUserStatus("user-1", PortalUserStatus.ACTIVE);
    user = await findPortalUserById("user-1");
    expect(user?.status).toBe(PortalUserStatus.ACTIVE);
  });

  it("updates a user's password hash", async () => {
    seed([
      {
        _id: "user-1",
        name: "Ada",
        email: "ada@example.com",
        organizationId: "org-1",
        tenantId: "tenant-1",
        role: UserRole.CUSTOMER_ADMIN,
        passwordHash: "old-hash",
        emailVerified: new Date(),
      },
    ]);

    await updatePortalUserPassword("ada@example.com", "new-hash");

    const user = await findPortalUserByEmail("ada@example.com");
    expect(user?.passwordHash).toBe("new-hash");
  });
});
