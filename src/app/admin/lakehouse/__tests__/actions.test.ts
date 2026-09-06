import { describe, expect, it, vi, beforeEach } from "vitest";

const { requireSuperuserContextMock, revalidatePathMock, redirectMock, triggerIngestionMock } = vi.hoisted(
  () => ({
    requireSuperuserContextMock: vi.fn(),
    revalidatePathMock: vi.fn(),
    redirectMock: vi.fn(),
    triggerIngestionMock: vi.fn(),
  }),
);

vi.mock("@/lib/admin", () => ({ requireSuperuserContext: requireSuperuserContextMock }));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));
vi.mock("next/navigation", () => ({ redirect: redirectMock }));
vi.mock("@/services", () => ({
  services: { lakehouseAdmin: { triggerIngestion: triggerIngestionMock } },
}));

import { triggerIngestionAction } from "@/app/admin/lakehouse/actions";

const ADMIN = { userId: "user-admin", name: "Platform Admin", email: "admin@platform.example.com" };

describe("admin lakehouse actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireSuperuserContextMock.mockResolvedValue(ADMIN);
  });

  it("gates on superuser, triggers ingestion, revalidates and redirects with a success flash", async () => {
    triggerIngestionMock.mockResolvedValue({ ok: true, status: "COMPLETED" });

    await triggerIngestionAction("exc-1");

    expect(requireSuperuserContextMock).toHaveBeenCalled();
    expect(triggerIngestionMock).toHaveBeenCalledWith("exc-1");
    expect(revalidatePathMock).toHaveBeenCalledWith("/admin/lakehouse");
    expect(redirectMock).toHaveBeenCalledWith(
      "/admin/lakehouse?ranExchangeId=exc-1&ranStatus=COMPLETED",
    );
  });

  it("includes error details in the redirect when ingestion fails", async () => {
    triggerIngestionMock.mockResolvedValue({
      ok: false,
      status: "FAILED",
      errorCode: "EXCHANGE_NOT_READY",
      errorMessage: "Exchange is not ready for ingestion.",
    });

    await triggerIngestionAction("exc-2");

    const redirectUrl = redirectMock.mock.calls[0]?.[0] as string;
    expect(redirectUrl).toContain("ranExchangeId=exc-2");
    expect(redirectUrl).toContain("ranStatus=FAILED");
    expect(redirectUrl).toContain("ranErrorCode=EXCHANGE_NOT_READY");
    expect(redirectUrl).toContain("ranErrorMessage=");
  });
});
