import { requireSuperuserContext } from "@/lib/admin";
import { services } from "@/services";
import { PageHeader, Card, CardHeader, CardTitle, CardContent } from "@/components/ui";
import { PlatformSettingsForm } from "./platform-settings-form";

export default async function AdminSettingsPage() {
  await requireSuperuserContext();
  const settings = await services.platformSettings.getSettings();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Platform Settings" description="Settings that apply across every organization on the platform." />

      <Card>
        <CardHeader>
          <CardTitle>General</CardTitle>
        </CardHeader>
        <CardContent>
          <PlatformSettingsForm settings={settings} />
        </CardContent>
      </Card>
    </div>
  );
}
