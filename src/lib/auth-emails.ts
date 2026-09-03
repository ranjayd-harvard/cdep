import { sendEmail } from "@/lib/mailer";

function appUrl(path: string): string {
  const base = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
  return `${base}${path}`;
}

export async function sendVerificationEmail(email: string, token: string): Promise<void> {
  const link = appUrl(`/verify-email?token=${encodeURIComponent(token)}`);
  await sendEmail({
    to: email,
    subject: "Verify your email",
    text: `Confirm your email address to finish setting up your account:\n\n${link}\n\nThis link expires in 24 hours.`,
    html: `<p>Confirm your email address to finish setting up your account:</p><p><a href="${link}">${link}</a></p><p>This link expires in 24 hours.</p>`,
  });
}

export async function sendPasswordResetEmail(email: string, token: string): Promise<void> {
  const link = appUrl(`/reset-password?token=${encodeURIComponent(token)}`);
  await sendEmail({
    to: email,
    subject: "Reset your password",
    text: `Reset your password using the link below:\n\n${link}\n\nThis link expires in 1 hour. If you didn't request this, you can ignore this email.`,
    html: `<p>Reset your password using the link below:</p><p><a href="${link}">${link}</a></p><p>This link expires in 1 hour. If you didn't request this, you can ignore this email.</p>`,
  });
}

export async function sendOrganizationInviteEmail(
  email: string,
  token: string,
  organizationDisplayName: string,
): Promise<void> {
  const link = appUrl(`/invite?token=${encodeURIComponent(token)}`);
  await sendEmail({
    to: email,
    subject: `You've been invited to join ${organizationDisplayName}`,
    text: `You've been invited to join ${organizationDisplayName} on Data Exchange:\n\n${link}\n\nThis link expires in 7 days.`,
    html: `<p>You've been invited to join <strong>${organizationDisplayName}</strong> on Data Exchange.</p><p><a href="${link}">${link}</a></p><p>This link expires in 7 days.</p>`,
  });
}
