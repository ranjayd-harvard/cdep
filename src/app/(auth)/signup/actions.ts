"use server";

import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { createPortalUser, findPortalUserByEmail } from "@/lib/user-directory";
import { createAuthToken } from "@/lib/auth-tokens";
import { sendVerificationEmail } from "@/lib/auth-emails";
import { getPlatformSettings } from "@/lib/platform-settings-directory";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VERIFICATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

export interface SignupState {
  error?: string;
}

/**
 * Self-serve signup: creates an account with no organization/tenant
 * assigned yet, then emails a verification link. The account can't sign
 * in until that link is followed — see the `emailVerified` check in
 * `src/auth.ts`. Which organization the user belongs to (join an
 * existing one, or create a new one) is resolved after login, in the
 * onboarding gate (see `src/app/(auth)/onboarding`).
 */
export async function signup(_prevState: SignupState, formData: FormData): Promise<SignupState> {
  const { allowSelfServeSignup } = await getPlatformSettings();
  if (!allowSelfServeSignup) {
    return { error: "Self-serve signup is currently disabled. Contact your administrator." };
  }

  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");

  if (!name || !email || !password) {
    return { error: "All fields are required." };
  }
  if (!EMAIL_PATTERN.test(email)) {
    return { error: "Enter a valid email address." };
  }
  if (password.length < 8) {
    return { error: "Password must be at least 8 characters." };
  }
  if (password !== confirmPassword) {
    return { error: "Passwords do not match." };
  }

  const existing = await findPortalUserByEmail(email);
  if (existing) {
    return { error: "An account with this email already exists. Try signing in instead." };
  }

  const passwordHash = await bcrypt.hash(password, 12);
  await createPortalUser({
    name,
    email,
    organizationId: null,
    tenantId: null,
    role: null,
    passwordHash,
  });

  const token = await createAuthToken(email, "verify-email", VERIFICATION_TOKEN_TTL_MS);
  await sendVerificationEmail(email, token);

  redirect(`/check-email?email=${encodeURIComponent(email)}`);
}
