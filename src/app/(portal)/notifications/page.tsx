import { requireTenantContext } from "@/lib/tenant";
import { services } from "@/services";
import { PageHeader } from "@/components/ui";
import { NotificationsList } from "./notifications-list";

export default async function NotificationsPage() {
  const tenant = await requireTenantContext();
  const notifications = await services.notifications.getNotifications(tenant.tenantId);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Notifications" description="Updates about your data exchanges and data products." />
      <NotificationsList initialNotifications={notifications} />
    </div>
  );
}
