import { NotificationType, Severity } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { emitToOrg } from '../../lib/realtime';
import { sendMail, isEmailConfigured } from '../../lib/email';
import { env } from '../../config/env';

export interface NotifyInput {
  organizationId: string;
  userId?: string | null;
  type: NotificationType;
  severity?: Severity;
  title: string;
  message: string;
  link?: string | null;
}

/** Resolve who should receive the email for a notification. */
async function resolveRecipients(input: NotifyInput): Promise<string[]> {
  const set = new Set<string>();
  if (input.userId) {
    const u = await prisma.user.findUnique({ where: { id: input.userId }, select: { email: true } });
    if (u?.email) set.add(u.email);
  } else {
    // Org-wide alert → notify admins and project managers.
    const admins = await prisma.user.findMany({
      where: { organizationId: input.organizationId, isActive: true, role: { in: ['SYSTEM_ADMIN', 'PROJECT_MANAGER'] } },
      select: { email: true },
    });
    admins.forEach((a) => set.add(a.email));
  }
  if (env.smtp.fallbackTo) set.add(env.smtp.fallbackTo);
  return [...set];
}

/**
 * Persists a notification, pushes it live over realtime, and emails recipients
 * (in-app + email channels, Module 9). Email is best-effort and never blocks the
 * triggering operation; LOW-severity items are not emailed to reduce noise.
 */
export async function notify(input: NotifyInput) {
  const notification = await prisma.notification.create({
    data: {
      organizationId: input.organizationId,
      userId: input.userId ?? null,
      type: input.type,
      severity: input.severity ?? 'LOW',
      title: input.title,
      message: input.message,
      link: input.link ?? null,
    },
  });

  emitToOrg(input.organizationId, 'notification', notification);

  // Email channel (fire-and-forget; skip LOW severity and when SMTP is off).
  const severity = input.severity ?? 'LOW';
  if (isEmailConfigured() && severity !== 'LOW') {
    void resolveRecipients(input)
      .then((to) =>
        sendMail({
          to,
          subject: `[INSPECTA ${severity}] ${input.title}`,
          text: `${input.message}\n\nType: ${input.type}\nSeverity: ${severity}\n\n— INSPECTA BUILDOS`,
          html: `<p>${input.message}</p><p style="color:#667;font-size:12px">Type: ${input.type} · Severity: ${severity}</p><p style="color:#99a;font-size:11px">— INSPECTA BUILDOS</p>`,
        }),
      )
      .catch(() => undefined);
  }

  return notification;
}
