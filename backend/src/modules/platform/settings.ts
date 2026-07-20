import { prisma } from '../../lib/prisma';

const SINGLETON_ID = 'global';

export interface PlatformSettingsInput {
  allowSelfSignup?: boolean;
  defaultCurrency?: string;
  defaultTimezone?: string | null;
  supportEmail?: string | null;
  maintenanceMessage?: string | null;
}

/**
 * Reads the platform settings row, creating it on first access so a fresh
 * database (or one migrated before this table existed) never 404s.
 */
export async function getPlatformSettings() {
  return prisma.platformSetting.upsert({
    where: { id: SINGLETON_ID },
    update: {},
    create: { id: SINGLETON_ID },
  });
}

export async function updatePlatformSettings(input: PlatformSettingsInput, updatedById: string) {
  return prisma.platformSetting.upsert({
    where: { id: SINGLETON_ID },
    update: { ...input, updatedById },
    create: { id: SINGLETON_ID, ...input, updatedById },
  });
}

/**
 * The subset of settings every client may see without authenticating — the
 * signup page needs to know whether self-service registration is open, and the
 * maintenance banner has to reach users who cannot sign in.
 */
export async function publicPlatformSettings() {
  const s = await getPlatformSettings();
  return {
    allowSelfSignup: s.allowSelfSignup,
    maintenanceMessage: s.maintenanceMessage,
    supportEmail: s.supportEmail,
  };
}
