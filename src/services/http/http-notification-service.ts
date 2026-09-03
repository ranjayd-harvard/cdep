import type { Notification } from "@/models";
import type { NotificationService } from "@/services/interfaces";
import { httpGet, httpPost } from "@/lib/http-client";

/**
 * Tenant identity is never sent over the wire — derived server-side from
 * the session. `getNotifications` has no matching list route today
 * (`(portal)/notifications/page.tsx` reads `services.notifications`
 * directly as a Server Component); only the two mutations below are
 * actually exercised by `notifications-list.tsx`.
 */
export class HttpNotificationService implements NotificationService {
  getNotifications(_tenantId: string): Promise<Notification[]> {
    return httpGet<Notification[]>(`/api/notifications`);
  }

  async markAsRead(_tenantId: string, notificationId: string): Promise<void> {
    await httpPost(`/api/notifications/${encodeURIComponent(notificationId)}/read`, {});
  }

  async markAllAsRead(_tenantId: string): Promise<void> {
    await httpPost(`/api/notifications/read-all`, {});
  }
}
