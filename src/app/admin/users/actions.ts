"use server";

import { revalidatePath } from "next/cache";
import { requireSuperuserContext } from "@/lib/admin";
import { setPortalUserRole, setPortalUserStatus } from "@/lib/user-directory";
import type { PortalUserStatus, UserRole } from "@/models";

/**
 * Admin Console only, platform-wide: reassigns any user's role, including
 * granting/revoking `SUPERUSER` — the one place platform-root is handed
 * out, kept independent of any single organization.
 */
export async function setUserRole(userId: string, role: UserRole): Promise<void> {
  const admin = await requireSuperuserContext();
  if (userId === admin.userId) {
    throw new Error("You can't change your own role.");
  }
  await setPortalUserRole(userId, role);
  revalidatePath("/admin/users");
}

/** Form-bindable wrapper: reads the role picked in the `<select name="role">`. */
export async function setUserRoleFromForm(userId: string, formData: FormData): Promise<void> {
  const role = String(formData.get("role") ?? "") as UserRole;
  await setUserRole(userId, role);
}

export async function setUserStatus(userId: string, status: PortalUserStatus): Promise<void> {
  const admin = await requireSuperuserContext();
  if (userId === admin.userId) {
    throw new Error("You can't suspend your own account.");
  }
  await setPortalUserStatus(userId, status);
  revalidatePath("/admin/users");
}
