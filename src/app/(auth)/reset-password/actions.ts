"use server";

import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { consumeAuthToken } from "@/lib/auth-tokens";
import { updatePortalUserPassword } from "@/lib/user-directory";

export interface ResetPasswordState {
  error?: string;
}

export async function resetPassword(_prevState: ResetPasswordState, formData: FormData): Promise<ResetPasswordState> {
  const token = String(formData.get("token") ?? "");
  const password = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");

  if (password.length < 8) {
    return { error: "Password must be at least 8 characters." };
  }
  if (password !== confirmPassword) {
    return { error: "Passwords do not match." };
  }

  const email = await consumeAuthToken(token, "reset-password");
  if (!email) {
    return { error: "This reset link is invalid or has expired. Request a new one." };
  }

  const passwordHash = await bcrypt.hash(password, 12);
  await updatePortalUserPassword(email, passwordHash);

  redirect("/login?reset=success");
}
