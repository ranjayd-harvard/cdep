import type { Notification } from "@/models";
import type { NotificationService } from "@/services/interfaces";
import { MOCK_NOTIFICATIONS } from "@/data/mocks/notifications";
import { DEFAULT_TENANT_ID } from "@/data/mocks/tenants";
import { simulateLatency } from "@/lib/simulate";

/**
 * Holds an in-memory copy so "Mark as Read" reflects immediately within a
 * running session. Nothing is persisted across page reloads or server
 * restarts — a real implementation would call the notifications API.
 */
export class MockNotificationService implements NotificationService {
  private notifications: Notification[] = MOCK_NOTIFICATIONS.map((n) => ({ ...n }));

  async getNotifications(tenantId: string): Promise<Notification[]> {
    await simulateLatency();
    if (tenantId !== DEFAULT_TENANT_ID) return [];
    return this.notifications;
  }

  async markAsRead(tenantId: string, notificationId: string): Promise<void> {
    await simulateLatency(100);
    if (tenantId !== DEFAULT_TENANT_ID) return;
    this.notifications = this.notifications.map((n) =>
      n.id === notificationId ? { ...n, read: true } : n,
    );
  }

  async markAllAsRead(tenantId: string): Promise<void> {
    await simulateLatency(150);
    if (tenantId !== DEFAULT_TENANT_ID) return;
    this.notifications = this.notifications.map((n) => ({ ...n, read: true }));
  }
}
