import { describe, expect, it, vi } from "vitest";
import { createFakeDb } from "@/test/fake-mongo";

const { getDbMock } = vi.hoisted(() => ({ getDbMock: vi.fn() }));

vi.mock("@/lib/mongodb", () => ({
  getDb: getDbMock,
}));

import { createAuthToken, consumeAuthToken } from "@/lib/auth-tokens";

function seed() {
  const db = createFakeDb({});
  getDbMock.mockResolvedValue(db);
}

describe("auth tokens", () => {
  it("consumes a freshly issued token and returns its email", async () => {
    seed();
    const token = await createAuthToken("user@example.com", "verify-email", 60_000);

    const email = await consumeAuthToken(token, "verify-email");

    expect(email).toBe("user@example.com");
  });

  it("is single-use — the same token can't be consumed twice", async () => {
    seed();
    const token = await createAuthToken("user@example.com", "verify-email", 60_000);

    await consumeAuthToken(token, "verify-email");
    const second = await consumeAuthToken(token, "verify-email");

    expect(second).toBeNull();
  });

  it("rejects a token consumed for the wrong purpose", async () => {
    seed();
    const token = await createAuthToken("user@example.com", "verify-email", 60_000);

    const result = await consumeAuthToken(token, "reset-password");

    expect(result).toBeNull();
  });

  it("rejects an already-expired token", async () => {
    seed();
    const token = await createAuthToken("user@example.com", "reset-password", -1);

    const result = await consumeAuthToken(token, "reset-password");

    expect(result).toBeNull();
  });

  it("rejects a token that was never issued", async () => {
    seed();

    const result = await consumeAuthToken("not-a-real-token", "verify-email");

    expect(result).toBeNull();
  });
});
