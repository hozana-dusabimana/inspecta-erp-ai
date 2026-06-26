import nodemailer, { Transporter } from 'nodemailer';
import { env } from '../config/env';

let transporter: Transporter | null = null;

export function isEmailConfigured(): boolean {
  return Boolean(env.smtp.host && env.smtp.user && env.smtp.pass);
}

function getTransporter(): Transporter | null {
  if (!isEmailConfigured()) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.smtp.host,
      port: env.smtp.port,
      secure: env.smtp.port === 465, // 465 = implicit TLS; 587 = STARTTLS
      auth: { user: env.smtp.user, pass: env.smtp.pass },
    });
  }
  return transporter;
}

export interface MailInput {
  to: string | string[];
  subject: string;
  text: string;
  html?: string;
}

/**
 * Sends an email. Best-effort: returns a result object instead of throwing so a
 * mail failure never breaks the business operation that triggered it.
 */
export async function sendMail(input: MailInput): Promise<{ ok: boolean; messageId?: string; error?: string; skipped?: boolean }> {
  const tx = getTransporter();
  if (!tx) return { ok: false, skipped: true, error: 'SMTP not configured' };
  const recipients = Array.isArray(input.to) ? input.to.filter(Boolean) : [input.to].filter(Boolean);
  if (recipients.length === 0) return { ok: false, skipped: true, error: 'No recipients' };
  try {
    const info = await tx.sendMail({
      from: env.smtp.from,
      to: recipients.join(', '),
      subject: input.subject,
      text: input.text,
      html: input.html,
    });
    return { ok: true, messageId: info.messageId };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Email send failed:', err);
    return { ok: false, error: err instanceof Error ? err.message : 'send failed' };
  }
}

/** Verifies SMTP connectivity (used by the admin test endpoint). */
export async function verifyEmail(): Promise<{ ok: boolean; error?: string }> {
  const tx = getTransporter();
  if (!tx) return { ok: false, error: 'SMTP not configured' };
  try {
    await tx.verify();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'verify failed' };
  }
}
