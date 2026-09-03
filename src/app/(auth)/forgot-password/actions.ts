"use server";

import { findPortalUserByEmail } from "@/lib/user-directory";
import { createAuthToken } from "@/lib/auth-tokens";
import { sendPasswordResetEmail } from "@/lib/auth-emails";

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;
const GENERIC_MESSAGE = "If an account exists for that email, we've sent a password reset link.";

export interface ForgotPasswordState {
  message?: string;
}

/**
 * Always returns the same message regardless of whether the email is
 * registered, has a password at all (Google-only accounts don't), or
 * is verified — so this can't be used to enumerate accounts.
 */
export async function requestPasswordReset(
  _prevState: ForgotPasswordState,
  formData: FormData,
): Promise<ForgotPasswordState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();

  if (email) {
    const user = await findPortalUserByEmail(email);
    if (user?.passwordHash) {
      const token = await createAuthToken(email, "reset-password", RESET_TOKEN_TTL_MS);
      await sendPasswordResetEmail(email, token);
    }
  }

  return { message: GENERIC_MESSAGE };
}
