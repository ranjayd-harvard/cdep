import type { Notification } from "@/models";

export interface NotificationService {
  getNotifications(tenantId: string): Promise<Notification[]>;
  markAsRead(tenantId: string, notificationId: string): Promise<void>;
  markAllAsRead(tenantId: string): Promise<void>;
}
