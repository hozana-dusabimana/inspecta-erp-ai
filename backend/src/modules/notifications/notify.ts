import { NotificationType, Severity } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { emitToOrg } from '../../lib/realtime';

export interface NotifyInput {
  organizationId: string;
  userId?: string | null;
  type: NotificationType;
  severity?: Severity;
  title: string;
  message: string;
  link?: string | null;
}

/**
 * Persists a notification and pushes it live to the organization over realtime.
 * Used by module afterChange hooks (low stock, NCR, incident, cost overrun...).
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
  return notification;
}
