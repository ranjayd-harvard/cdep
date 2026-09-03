"use server";

import { findPortalUserByEmail } from "@/lib/user-directory";
import { createAuthToken } from "@/lib/auth-tokens";
import { sendVerificationEmail } from "@/lib/auth-emails";

const VERIFICATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Re-issues a verification email. Silently no-ops for an unknown email
 * or an already-verified account so this can't be used to probe which
 * emails are registered.
 */
export async function resendVerificationEmail(email: string): Promise<void> {
  const user = await findPortalUserByEmail(email);
  if (!user || user.emailVerified) {
    return;
  }

  const token = await createAuthToken(email, "verify-email", VERIFICATION_TOKEN_TTL_MS);
  await sendVerificationEmail(email, token);
}
