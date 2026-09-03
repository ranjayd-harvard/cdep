import nodemailer, { type Transporter } from "nodemailer";

interface SendEmailInput {
  to: string;
  subject: string;
  text: string;
  html: string;
}

let transport: Transporter | null | undefined;

function getTransport(): Transporter | null {
  if (transport !== undefined) {
    return transport;
  }

  const host = process.env.SMTP_HOST;
  if (!host) {
    transport = null;
    return transport;
  }

  transport = nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: process.env.SMTP_SECURE === "true",
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      : undefined,
  });
  return transport;
}

/**
 * Sends transactional auth emails (verification, password reset) over
 * SMTP. Without `SMTP_HOST` configured, logs the message to the console
 * instead so the signup/verify/reset flows are fully exercisable in
 * local dev before real SMTP credentials exist.
 */
export async function sendEmail(input: SendEmailInput): Promise<void> {
  const client = getTransport();
  if (!client) {
    console.log(
      `[mailer] SMTP not configured — logging email instead of sending it.\n` +
        `To: ${input.to}\nSubject: ${input.subject}\n\n${input.text}`,
    );
    return;
  }

  await client.sendMail({
    from: process.env.SMTP_FROM ?? "no-reply@portal.local",
    to: input.to,
    subject: input.subject,
    text: input.text,
    html: input.html,
  });
}
