import { describe, expect, it, vi } from "vitest";
import { createFakeDb } from "@/test/fake-mongo";

const { getDbMock } = vi.hoisted(() => ({ getDbMock: vi.fn() }));

vi.mock("@/lib/mongodb", () => ({
  getDb: getDbMock,
}));

import { getPlatformSettings, updatePlatformSettings } from "@/lib/platform-settings-directory";

describe("platform settings directory", () => {
  it("returns the defaults when no settings document exists yet", async () => {
    getDbMock.mockResolvedValue(createFakeDb({}));

    const settings = await getPlatformSettings();

    expect(settings).toEqual({ allowSelfServeSignup: true, supportEmail: "" });
  });

  it("creates the singleton on first update, applying defaults to fields not in the patch", async () => {
    getDbMock.mockResolvedValue(createFakeDb({}));

    await updatePlatformSettings({ allowSelfServeSignup: false });

    const settings = await getPlatformSettings();
    expect(settings).toEqual({ allowSelfServeSignup: false, supportEmail: "" });
  });

  it("merges a partial patch into an existing singleton without clobbering other fields", async () => {
    getDbMock.mockResolvedValue(createFakeDb({}));
    await updatePlatformSettings({ allowSelfServeSignup: false, supportEmail: "support@example.com" });

    await updatePlatformSettings({ allowSelfServeSignup: true });

    const settings = await getPlatformSettings();
    expect(settings).toEqual({ allowSelfServeSignup: true, supportEmail: "support@example.com" });
  });
});
