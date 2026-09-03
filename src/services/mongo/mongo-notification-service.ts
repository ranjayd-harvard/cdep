import type { Notification } from "@/models";
import type { NotificationService } from "@/services/interfaces";
import { listNotifications, markNotificationRead, markAllNotificationsRead } from "@/lib/notification-directory";

export class MongoNotificationService implements NotificationService {
  getNotifications(tenantId: string): Promise<Notification[]> {
    return listNotifications(tenantId);
  }

  markAsRead(tenantId: string, notificationId: string): Promise<void> {
    return markNotificationRead(tenantId, notificationId);
  }

  markAllAsRead(tenantId: string): Promise<void> {
    return markAllNotificationsRead(tenantId);
  }
}
