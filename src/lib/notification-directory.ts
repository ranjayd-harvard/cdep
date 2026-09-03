import { randomBytes } from "node:crypto";
import { getDb } from "@/lib/mongodb";
import { getTenantScopedCollection, type TenantOwnedDocument } from "@/lib/tenant-scoped-collection";
import type { Notification, NotificationType } from "@/models";

interface NotificationDocument extends TenantOwnedDocument {
  _id: string;
  type: NotificationType;
  title: string;
  message: string;
  createdAt: string;
  read: boolean;
}

function toNotification(doc: NotificationDocument): Notification {
  const { _id, tenantId: _tenantId, ...rest } = doc;
  return { id: _id, ...rest };
}

export async function listNotifications(tenantId: string): Promise<Notification[]> {
  const db = await getDb();
  const notifications = getTenantScopedCollection<NotificationDocument>(db, "notifications", tenantId);
  const docs = await notifications.find().sort({ createdAt: -1 }).toArray();
  return docs.map(toNotification);
}

export interface CreateNotificationInput {
  type: NotificationType;
  title: string;
  message: string;
}

export async function createNotification(tenantId: string, input: CreateNotificationInput): Promise<Notification> {
  const db = await getDb();
  const notifications = getTenantScopedCollection<NotificationDocument>(db, "notifications", tenantId);
  const doc: NotificationDocument = {
    _id: `notif-${randomBytes(4).toString("hex")}`,
    tenantId,
    type: input.type,
    title: input.title,
    message: input.message,
    createdAt: new Date().toISOString(),
    read: false,
  };
  await notifications.insertOne(doc);
  return toNotification(doc);
}

export async function markNotificationRead(tenantId: string, notificationId: string): Promise<void> {
  const db = await getDb();
  const notifications = getTenantScopedCollection<NotificationDocument>(db, "notifications", tenantId);
  await notifications.updateOne({ _id: notificationId }, { $set: { read: true } });
}

export async function markAllNotificationsRead(tenantId: string): Promise<void> {
  const db = await getDb();
  const notifications = getTenantScopedCollection<NotificationDocument>(db, "notifications", tenantId);
  await notifications.updateMany({ read: false }, { $set: { read: true } });
}
