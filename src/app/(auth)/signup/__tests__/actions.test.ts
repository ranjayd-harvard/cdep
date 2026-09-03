import { describe, expect, it, vi, beforeEach } from "vitest";

const { redirectMock, createPortalUserMock, findPortalUserByEmailMock, createAuthTokenMock, sendVerificationEmailMock, getPlatformSettingsMock } =
  vi.hoisted(() => ({
    redirectMock: vi.fn(),
    createPortalUserMock: vi.fn(),
    findPortalUserByEmailMock: vi.fn(),
    createAuthTokenMock: vi.fn(),
    sendVerificationEmailMock: vi.fn(),
    getPlatformSettingsMock: vi.fn(),
  }));

vi.mock("next/navigation", () => ({ redirect: redirectMock }));
vi.mock("@/lib/user-directory", () => ({
  createPortalUser: createPortalUserMock,
  findPortalUserByEmail: findPortalUserByEmailMock,
}));
vi.mock("@/lib/auth-tokens", () => ({ createAuthToken: createAuthTokenMock }));
vi.mock("@/lib/auth-emails", () => ({ sendVerificationEmail: sendVerificationEmailMock }));
vi.mock("@/lib/platform-settings-directory", () => ({ getPlatformSettings: getPlatformSettingsMock }));

import { signup } from "@/app/(auth)/signup/actions";

function makeFormData(fields: Record<string, string>) {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    formData.set(key, value);
  }
  return formData;
}

const VALID_SIGNUP = {
  name: "Ada Lovelace",
  email: "ada@example.com",
  password: "password123",
  confirmPassword: "password123",
};

describe("signup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    redirectMock.mockImplementation(() => {
      throw new Error("REDIRECT");
    });
    getPlatformSettingsMock.mockResolvedValue({ allowSelfServeSignup: true, supportEmail: "" });
    findPortalUserByEmailMock.mockResolvedValue(null);
  });

  it("rejects with a clear error when the platform has disabled self-serve signup", async () => {
    getPlatformSettingsMock.mockResolvedValue({ allowSelfServeSignup: false, supportEmail: "" });

    const result = await signup({}, makeFormData(VALID_SIGNUP));

    expect(result.error).toMatch(/disabled/i);
    expect(createPortalUserMock).not.toHaveBeenCalled();
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("proceeds as normal when self-serve signup is allowed", async () => {
    createAuthTokenMock.mockResolvedValue("token-1");

    await expect(signup({}, makeFormData(VALID_SIGNUP))).rejects.toThrow("REDIRECT");

    expect(createPortalUserMock).toHaveBeenCalled();
    expect(redirectMock).toHaveBeenCalledWith(expect.stringContaining("/check-email"));
  });
});
