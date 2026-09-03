"use server";

import { revalidatePath } from "next/cache";
import { requireSuperuserContext } from "@/lib/admin";
import { services } from "@/services";

export interface UpdatePlatformSettingsState {
  error?: string;
  success?: boolean;
}

export async function updatePlatformSettings(
  _prevState: UpdatePlatformSettingsState,
  formData: FormData,
): Promise<UpdatePlatformSettingsState> {
  await requireSuperuserContext();

  const allowSelfServeSignup = formData.get("allowSelfServeSignup") === "on";
  const supportEmail = String(formData.get("supportEmail") ?? "").trim();

  await services.platformSettings.updateSettings({ allowSelfServeSignup, supportEmail });
  revalidatePath("/admin/settings");
  return { success: true };
}
