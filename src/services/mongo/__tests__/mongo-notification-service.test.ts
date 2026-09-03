import { describe, expect, it, vi } from "vitest";
import { createFakeDb } from "@/test/fake-mongo";

const { getDbMock } = vi.hoisted(() => ({ getDbMock: vi.fn() }));

vi.mock("@/lib/mongodb", () => ({
  getDb: getDbMock,
}));

import { MongoNotificationService } from "@/services/mongo/mongo-notification-service";

const TENANT_A = "tenant-a";
const TENANT_B = "tenant-b";

function seed() {
  const db = createFakeDb({
    notifications: [
      { _id: "notif-a1", tenantId: TENANT_A, type: "EXCHANGE_COMPLETED", title: "A", message: "a", createdAt: "2026-01-01T00:00:00Z", read: false },
      { _id: "notif-a2", tenantId: TENANT_A, type: "EXCHANGE_FAILED", title: "A2", message: "a2", createdAt: "2026-01-02T00:00:00Z", read: false },
      { _id: "notif-b1", tenantId: TENANT_B, type: "EXCHANGE_COMPLETED", title: "B", message: "b", createdAt: "2026-01-01T00:00:00Z", read: false },
    ],
  });
  getDbMock.mockResolvedValue(db);
  return db;
}

describe("MongoNotificationService", () => {
  it("only returns notifications belonging to the requesting tenant", async () => {
    seed();
    const service = new MongoNotificationService();

    const notifications = await service.getNotifications(TENANT_A);

    expect(notifications).toHaveLength(2);
    expect(notifications.every((n) => n.id.startsWith("notif-a"))).toBe(true);
  });

  it("marks a single notification as read without affecting others", async () => {
    seed();
    const service = new MongoNotificationService();

    await service.markAsRead(TENANT_A, "notif-a1");
    const notifications = await service.getNotifications(TENANT_A);

    expect(notifications.find((n) => n.id === "notif-a1")?.read).toBe(true);
    expect(notifications.find((n) => n.id === "notif-a2")?.read).toBe(false);
  });

  it("marks all of a tenant's notifications as read without touching another tenant's", async () => {
    const db = seed();
    const service = new MongoNotificationService();

    await service.markAllAsRead(TENANT_A);

    const tenantA = await service.getNotifications(TENANT_A);
    expect(tenantA.every((n) => n.read)).toBe(true);

    const raw = await db.collection("notifications").find({ tenantId: TENANT_B }).toArray();
    expect(raw.every((n) => n.read === false)).toBe(true);
  });
});
