import { describe, expect, it, vi } from "vitest";
import { createFakeDb } from "@/test/fake-mongo";

const { getDbMock } = vi.hoisted(() => ({ getDbMock: vi.fn() }));

vi.mock("@/lib/mongodb", () => ({
  getDb: getDbMock,
}));

import { createApiKey, listApiKeys, revokeApiKey, verifyApiKey } from "@/lib/api-key-directory";

describe("createApiKey", () => {
  it("issues a key whose raw secret is only ever returned once", async () => {
    getDbMock.mockResolvedValue(createFakeDb({}));

    const { credential, secret } = await createApiKey("tenant-1", "Production Uploads", "admin@example.com");

    expect(secret).toMatch(/^cdep_live_[0-9a-f]{48}$/);
    expect(credential.label).toBe("Production Uploads");
    expect(credential.status).toBe("active");
    expect(credential.createdBy).toBe("admin@example.com");
    expect(credential.maskedKey).not.toContain(secret);
    expect(credential.maskedKey.endsWith(secret.slice(-4))).toBe(true);
  });

  it("gives two keys for the same tenant distinct ids and secrets", async () => {
    getDbMock.mockResolvedValue(createFakeDb({}));

    const first = await createApiKey("tenant-1", "Key A", "admin@example.com");
    const second = await createApiKey("tenant-1", "Key B", "admin@example.com");

    expect(first.credential.id).not.toBe(second.credential.id);
    expect(first.secret).not.toBe(second.secret);
  });
});

describe("listApiKeys", () => {
  it("only returns keys belonging to the requested tenant", async () => {
    const db = createFakeDb({});
    getDbMock.mockResolvedValue(db);

    await createApiKey("tenant-1", "Tenant 1 Key", "admin@example.com");
    await createApiKey("tenant-2", "Tenant 2 Key", "admin@example.com");

    const tenant1Keys = await listApiKeys("tenant-1");
    expect(tenant1Keys).toHaveLength(1);
    expect(tenant1Keys[0].label).toBe("Tenant 1 Key");
  });
});

describe("revokeApiKey", () => {
  it("flips an active key to revoked and stamps revokedAt", async () => {
    getDbMock.mockResolvedValue(createFakeDb({}));
    const { credential } = await createApiKey("tenant-1", "Key A", "admin@example.com");

    await revokeApiKey("tenant-1", credential.id);

    const [updated] = await listApiKeys("tenant-1");
    expect(updated.status).toBe("revoked");
    expect(updated.revokedAt).not.toBeNull();
  });

  it("no-ops when the key belongs to a different tenant", async () => {
    getDbMock.mockResolvedValue(createFakeDb({}));
    const { credential } = await createApiKey("tenant-1", "Key A", "admin@example.com");

    await revokeApiKey("tenant-2", credential.id);

    const [unchanged] = await listApiKeys("tenant-1");
    expect(unchanged.status).toBe("active");
  });
});

describe("verifyApiKey", () => {
  it("resolves a raw secret to its owning tenant and records lastUsedAt", async () => {
    getDbMock.mockResolvedValue(createFakeDb({}));
    const { secret } = await createApiKey("tenant-1", "Key A", "admin@example.com");

    const result = await verifyApiKey(secret);
    expect(result).toEqual({ tenantId: "tenant-1", keyId: expect.any(String) });

    const [credential] = await listApiKeys("tenant-1");
    expect(credential.lastUsedAt).not.toBeNull();
  });

  it("rejects an unknown secret", async () => {
    getDbMock.mockResolvedValue(createFakeDb({}));

    expect(await verifyApiKey("cdep_live_not-a-real-key")).toBeNull();
  });

  it("rejects a revoked key", async () => {
    getDbMock.mockResolvedValue(createFakeDb({}));
    const { credential, secret } = await createApiKey("tenant-1", "Key A", "admin@example.com");
    await revokeApiKey("tenant-1", credential.id);

    expect(await verifyApiKey(secret)).toBeNull();
  });
});
