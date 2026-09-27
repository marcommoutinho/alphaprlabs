import "server-only";
import nodemailer from "nodemailer";

/** SMTP settings (SMTP_* env). Locally: Supabase's Mailpit on 127.0.0.1:54425. */
export type SmtpSettings = {
  host: string;
  port: number;
  user?: string;
  pass?: string;
  from: string;
};

export function smtpSettingsFromEnv(): SmtpSettings {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM } = process.env;
  if (!SMTP_HOST || !SMTP_PORT || !SMTP_FROM) {
    throw new Error("SMTP_HOST, SMTP_PORT and SMTP_FROM must be set to send invitations.");
  }
  return { host: SMTP_HOST, port: Number(SMTP_PORT), user: SMTP_USER || undefined, pass: SMTP_PASS || undefined, from: SMTP_FROM };
}

const isLoopback = (host: string) => host === "localhost" || host === "127.0.0.1" || host === "::1";

/**
 * Sends the plain invitation email: a subject and one link. It never names
 * the inviting admin (Marco, 2026-09-27: researchers never learn which admin
 * it is). Throws on any SMTP failure. The link carries the raw token, so
 * neither the link nor the message is ever logged.
 */
export async function sendInvitationEmail(
  message: { to: string; name: string; link: string },
  smtp: SmtpSettings = smtpSettingsFromEnv(),
): Promise<void> {
  const transport = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.port === 465,
    // Production SMTP (Postmark) must use TLS; the local capture inbox has none.
    requireTLS: !isLoopback(smtp.host) && smtp.port !== 465,
    auth: smtp.user ? { user: smtp.user, pass: smtp.pass ?? "" } : undefined,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
    logger: false,
  });
  try {
    await transport.sendMail({
      from: smtp.from,
      to: message.to,
      subject: "Your invitation to Alpha PR Labs Research",
      text: [
        `Hi ${message.name},`,
        "",
        "You've been invited to Alpha PR Labs Research. Accept the invitation and set your password here:",
        "",
        message.link,
        "",
        "The link works once and is valid for 30 days.",
      ].join("\n"),
    });
  } finally {
    transport.close();
  }
}

/** A short, token-free description of a send failure for the invitation row. */
export function describeSendError(error: unknown): string {
  if (error instanceof Error) {
    const code = (error as Error & { code?: string }).code;
    return (code ? `${code}: ${error.message}` : error.message).slice(0, 500);
  }
  return "Unknown error";
}
