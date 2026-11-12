import nodemailer, { Transporter } from 'nodemailer';
import { env } from '../config/env';
import { debugLog, extractSecrets } from './debug-log';

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
  const recipients = Array.isArray(input.to) ? input.to.filter(Boolean) : [input.to].filter(Boolean);
  const secret = extractSecrets(`${input.text}\n${input.html ?? ''}`);
  if (!tx) {
    debugLog({ level: 'WARN', category: 'EMAIL', message: 'Email NOT sent: SMTP is not configured (SMTP_HOST / SMTP_USER / SMTP_PASS)', meta: { to: recipients, subject: input.subject }, secret });
    return { ok: false, skipped: true, error: 'SMTP not configured' };
  }
  if (recipients.length === 0) return { ok: false, skipped: true, error: 'No recipients' };
  try {
    const info = await tx.sendMail({
      from: env.smtp.from,
      to: recipients.join(', '),
      subject: input.subject,
      text: input.text,
      html: input.html,
    });
    debugLog({ category: 'EMAIL', message: `Email sent: ${input.subject}`, meta: { to: recipients, messageId: info.messageId, accepted: info.accepted, rejected: info.rejected, response: info.response }, secret });
    return { ok: true, messageId: info.messageId };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Email send failed:', err);
    const e = err as { code?: string; command?: string; responseCode?: number; response?: string };
    debugLog({ level: 'ERROR', category: 'EMAIL', message: `Email FAILED: ${err instanceof Error ? err.message : 'send failed'}`, meta: { to: recipients, subject: input.subject, code: e.code, command: e.command, responseCode: e.responseCode, response: e.response, host: env.smtp.host, port: env.smtp.port, user: env.smtp.user }, secret });
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
