import type { Notification } from "@/models";
import { Badge, EmptyState } from "@/components/ui";
import { NOTIFICATION_META } from "@/lib/format-notification";
import { formatDateTime } from "@/lib/utils";
import { cn } from "@/lib/utils";

export function NotificationsPreview({ notifications }: { notifications: Notification[] }) {
  if (notifications.length === 0) {
    return <EmptyState title="No notifications" />;
  }

  return (
    <ul className="divide-y divide-slate-100">
      {notifications.map((notification) => {
        const meta = NOTIFICATION_META[notification.type];
        const Icon = meta.icon;
        return (
          <li key={notification.id} className="flex items-start gap-3 py-3">
            <span className="mt-0.5 rounded-md bg-slate-50 p-1.5">
              <Icon className="h-4 w-4 text-slate-500" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p
                  className={cn(
                    "truncate text-sm",
                    notification.read ? "text-slate-600" : "font-semibold text-slate-900",
                  )}
                >
                  {notification.title}
                </p>
                {!notification.read ? <Badge color={meta.color}>New</Badge> : null}
              </div>
              <p className="line-clamp-1 text-xs text-slate-500">{notification.message}</p>
              <p className="mt-0.5 text-xs text-slate-400">{formatDateTime(notification.createdAt)}</p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
