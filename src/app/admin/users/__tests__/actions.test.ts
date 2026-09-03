import { describe, expect, it, vi, beforeEach } from "vitest";

const { requireSuperuserContextMock, revalidatePathMock, setPortalUserRoleMock, setPortalUserStatusMock } = vi.hoisted(() => ({
  requireSuperuserContextMock: vi.fn(),
  revalidatePathMock: vi.fn(),
  setPortalUserRoleMock: vi.fn(),
  setPortalUserStatusMock: vi.fn(),
}));

vi.mock("@/lib/admin", () => ({ requireSuperuserContext: requireSuperuserContextMock }));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));
vi.mock("@/lib/user-directory", () => ({
  setPortalUserRole: setPortalUserRoleMock,
  setPortalUserStatus: setPortalUserStatusMock,
}));

import { setUserRole, setUserStatus } from "@/app/admin/users/actions";
import { PortalUserStatus, UserRole } from "@/models";

const ADMIN = { userId: "user-admin", name: "Platform Admin", email: "admin@platform.example.com" };

describe("admin users actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireSuperuserContextMock.mockResolvedValue(ADMIN);
  });

  describe("setUserRole", () => {
    it("reassigns another user's role and revalidates the users page", async () => {
      await setUserRole("user-1", UserRole.SUPERUSER);

      expect(setPortalUserRoleMock).toHaveBeenCalledWith("user-1", UserRole.SUPERUSER);
      expect(revalidatePathMock).toHaveBeenCalledWith("/admin/users");
    });

    it("refuses to let a superuser change their own role", async () => {
      await expect(setUserRole("user-admin", UserRole.CUSTOMER_USER)).rejects.toThrow(/own role/i);
      expect(setPortalUserRoleMock).not.toHaveBeenCalled();
    });
  });

  describe("setUserStatus", () => {
    it("suspends another user", async () => {
      await setUserStatus("user-1", PortalUserStatus.SUSPENDED);

      expect(setPortalUserStatusMock).toHaveBeenCalledWith("user-1", PortalUserStatus.SUSPENDED);
      expect(revalidatePathMock).toHaveBeenCalledWith("/admin/users");
    });

    it("refuses to let a superuser suspend their own account", async () => {
      await expect(setUserStatus("user-admin", PortalUserStatus.SUSPENDED)).rejects.toThrow(/own account/i);
      expect(setPortalUserStatusMock).not.toHaveBeenCalled();
    });
  });
});
