import { describe, expect, it, vi, beforeEach } from "vitest";

const { authMock, redirectMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  redirectMock: vi.fn(),
}));

vi.mock("@/auth", () => ({
  auth: authMock,
}));

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
}));

import { requireSuperuserContext } from "@/lib/admin";
import { UserRole } from "@/models";

describe("requireSuperuserContext", () => {
  beforeEach(() => {
    authMock.mockReset();
    redirectMock.mockReset();
  });

  it("redirects unauthenticated requests to /login", async () => {
    authMock.mockResolvedValue(null);
    redirectMock.mockImplementation(() => {
      throw new Error("REDIRECT");
    });

    await expect(requireSuperuserContext()).rejects.toThrow("REDIRECT");
    expect(redirectMock).toHaveBeenCalledWith("/login");
  });

  it("bounces a signed-in non-superuser to /dashboard rather than exposing the Admin Console", async () => {
    authMock.mockResolvedValue({
      user: {
        id: "user-1",
        name: "Regular User",
        email: "user@example.com",
        organizationId: "org-1",
        tenantId: "tenant-1",
        role: UserRole.CUSTOMER_ADMIN,
      },
    });
    redirectMock.mockImplementation(() => {
      throw new Error("REDIRECT");
    });

    await expect(requireSuperuserContext()).rejects.toThrow("REDIRECT");
    expect(redirectMock).toHaveBeenCalledWith("/dashboard");
  });

  it("returns identity for a signed-in superuser", async () => {
    authMock.mockResolvedValue({
      user: {
        id: "user-admin",
        name: "Platform Admin",
        email: "admin@platform.example.com",
        organizationId: null,
        tenantId: null,
        role: UserRole.SUPERUSER,
      },
    });

    const admin = await requireSuperuserContext();

    expect(admin).toEqual({ userId: "user-admin", name: "Platform Admin", email: "admin@platform.example.com" });
    expect(redirectMock).not.toHaveBeenCalled();
  });
});
