"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import type { Notification } from "@/models";
import { clientServices } from "@/services/client";
import { Badge, Button, Card, CardContent, EmptyState } from "@/components/ui";
import { NOTIFICATION_META } from "@/lib/format-notification";
import { formatDateTime, cn } from "@/lib/utils";

export function NotificationsList({ initialNotifications }: { initialNotifications: Notification[] }) {
  const { data: session } = useSession();
  const [notifications, setNotifications] = useState(initialNotifications);

  const unreadCount = notifications.filter((n) => !n.read).length;

  async function handleMarkAsRead(notificationId: string) {
    if (!session?.user?.tenantId) return;
    setNotifications((prev) => prev.map((n) => (n.id === notificationId ? { ...n, read: true } : n)));
    await clientServices.notifications.markAsRead(session.user.tenantId, notificationId);
  }

  async function handleMarkAllAsRead() {
    if (!session?.user?.tenantId) return;
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    await clientServices.notifications.markAllAsRead(session.user.tenantId);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">
          {unreadCount > 0 ? `${unreadCount} unread` : "All caught up"}
        </p>
        <Button variant="secondary" size="sm" onClick={handleMarkAllAsRead} disabled={unreadCount === 0}>
          Mark All as Read
        </Button>
      </div>

      {notifications.length === 0 ? (
        <EmptyState title="No notifications" />
      ) : (
        <Card>
          <CardContent className="p-0">
            <ul className="divide-y divide-slate-100">
              {notifications.map((notification) => {
                const meta = NOTIFICATION_META[notification.type];
                const Icon = meta.icon;
                return (
                  <li key={notification.id} className="flex items-start gap-3 px-5 py-4">
                    <span className="mt-0.5 rounded-md bg-slate-50 p-2">
                      <Icon className="h-4 w-4 text-slate-500" aria-hidden="true" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p
                          className={cn(
                            "text-sm",
                            notification.read ? "text-slate-600" : "font-semibold text-slate-900",
                          )}
                        >
                          {notification.title}
                        </p>
                        <Badge color={meta.color}>{meta.label}</Badge>
                      </div>
                      <p className="mt-0.5 text-sm text-slate-500">{notification.message}</p>
                      <p className="mt-1 text-xs text-slate-400">
                        {formatDateTime(notification.createdAt)}
                      </p>
                    </div>
                    {!notification.read ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleMarkAsRead(notification.id)}
                        className="shrink-0"
                      >
                        Mark as Read
                      </Button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
