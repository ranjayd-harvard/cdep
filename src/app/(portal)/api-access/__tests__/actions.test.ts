import { describe, expect, it, vi, beforeEach } from "vitest";

const { requireTenantContextMock, revalidatePathMock, createApiKeyMock, revokeApiKeyMock } = vi.hoisted(() => ({
  requireTenantContextMock: vi.fn(),
  revalidatePathMock: vi.fn(),
  createApiKeyMock: vi.fn(),
  revokeApiKeyMock: vi.fn(),
}));

vi.mock("@/lib/tenant", () => ({ requireTenantContext: requireTenantContextMock }));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));
vi.mock("@/services", () => ({
  services: {
    apiAccess: {
      createApiKey: createApiKeyMock,
      revokeApiKey: revokeApiKeyMock,
    },
  },
}));

import { createApiKeyAction, revokeApiKeyAction } from "@/app/(portal)/api-access/actions";
import { UserRole } from "@/models";

const ADMIN_TENANT = {
  userId: "user-1",
  organizationId: "org-1",
  tenantId: "tenant-default",
  role: UserRole.CUSTOMER_ADMIN,
  name: "Admin",
  email: "admin@example.com",
};
const NON_ADMIN_TENANT = { ...ADMIN_TENANT, role: UserRole.CUSTOMER_USER };

function makeFormData(fields: Record<string, string>) {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    formData.set(key, value);
  }
  return formData;
}

describe("api-access actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("createApiKeyAction", () => {
    it("rejects a non-admin without creating a key", async () => {
      requireTenantContextMock.mockResolvedValue(NON_ADMIN_TENANT);

      const state = await createApiKeyAction({}, makeFormData({ label: "My Key" }));

      expect(state.error).toMatch(/admin/i);
      expect(createApiKeyMock).not.toHaveBeenCalled();
    });

    it("rejects a blank label", async () => {
      requireTenantContextMock.mockResolvedValue(ADMIN_TENANT);

      const state = await createApiKeyAction({}, makeFormData({ label: "   " }));

      expect(state.error).toMatch(/label/i);
      expect(createApiKeyMock).not.toHaveBeenCalled();
    });

    it("creates a key for the caller's tenant and returns the one-time secret", async () => {
      requireTenantContextMock.mockResolvedValue(ADMIN_TENANT);
      createApiKeyMock.mockResolvedValue({
        credential: { id: "key-1", label: "My Key" },
        secret: "cdep_live_abc123",
      });

      const state = await createApiKeyAction({}, makeFormData({ label: "My Key" }));

      expect(createApiKeyMock).toHaveBeenCalledWith("tenant-default", "My Key", "admin@example.com");
      expect(state).toEqual({ createdSecret: "cdep_live_abc123", createdLabel: "My Key" });
      expect(revalidatePathMock).toHaveBeenCalledWith("/api-access");
    });
  });

  describe("revokeApiKeyAction", () => {
    it("rejects (throws) when the caller isn't an org admin", async () => {
      requireTenantContextMock.mockResolvedValue(NON_ADMIN_TENANT);

      await expect(revokeApiKeyAction("key-1")).rejects.toThrow(/admin/i);
      expect(revokeApiKeyMock).not.toHaveBeenCalled();
    });

    it("revokes the key scoped to the caller's own tenant", async () => {
      requireTenantContextMock.mockResolvedValue(ADMIN_TENANT);

      await revokeApiKeyAction("key-1");

      expect(revokeApiKeyMock).toHaveBeenCalledWith("tenant-default", "key-1");
      expect(revalidatePathMock).toHaveBeenCalledWith("/api-access");
    });
  });
});
