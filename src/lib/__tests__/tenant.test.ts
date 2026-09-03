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

import { requireTenantContext } from "@/lib/tenant";
import { UserRole } from "@/models";

describe("requireTenantContext", () => {
  beforeEach(() => {
    authMock.mockReset();
    redirectMock.mockReset();
  });

  it("redirects unauthenticated requests to /login instead of exposing a tenantId", async () => {
    authMock.mockResolvedValue(null);
    redirectMock.mockImplementation(() => {
      throw new Error("REDIRECT");
    });

    await expect(requireTenantContext()).rejects.toThrow("REDIRECT");
    expect(redirectMock).toHaveBeenCalledWith("/login");
  });

  it("redirects a signed-in SUPERUSER to /admin instead of /onboarding, even though org/tenant are null", async () => {
    authMock.mockResolvedValue({
      user: {
        id: "user-1",
        name: "Platform Admin",
        email: "admin@platform.example.com",
        organizationId: null,
        tenantId: null,
        role: UserRole.SUPERUSER,
      },
    });
    redirectMock.mockImplementation(() => {
      throw new Error("REDIRECT");
    });

    await expect(requireTenantContext()).rejects.toThrow("REDIRECT");
    expect(redirectMock).toHaveBeenCalledWith("/admin");
  });

  it("redirects a signed-in user with no organization/tenant yet to /onboarding", async () => {
    authMock.mockResolvedValue({
      user: {
        id: "user-1",
        name: "Test User",
        email: "test@example.com",
        organizationId: null,
        tenantId: null,
        role: null,
      },
    });
    redirectMock.mockImplementation(() => {
      throw new Error("REDIRECT");
    });

    await expect(requireTenantContext()).rejects.toThrow("REDIRECT");
    expect(redirectMock).toHaveBeenCalledWith("/onboarding");
  });

  it("derives the tenant identity exclusively from the session, never from caller input", async () => {
    authMock.mockResolvedValue({
      user: {
        id: "user-1",
        name: "Test User",
        email: "test@example.com",
        organizationId: "org-1",
        tenantId: "tenant-1",
        role: UserRole.CUSTOMER_ADMIN,
      },
    });

    const tenant = await requireTenantContext();

    expect(tenant).toEqual({
      userId: "user-1",
      organizationId: "org-1",
      tenantId: "tenant-1",
      role: UserRole.CUSTOMER_ADMIN,
      name: "Test User",
      email: "test@example.com",
    });
    expect(redirectMock).not.toHaveBeenCalled();
  });
});
