import { Request, Response, NextFunction } from 'express';
import { Role } from '@prisma/client';
import { verifyAccessToken } from '../lib/jwt';
import { prisma } from '../lib/prisma';
import { asyncHandler } from '../lib/http';
import { Unauthorized, Forbidden } from '../lib/errors';
import { can, isPlatformRole, Permission } from '../auth/permissions';

export interface AuthUser {
  id: string;
  orgId: string;
  role: Role;
  email: string;
  isPlatformAdmin: boolean;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

/**
 * Verifies the Bearer access token, re-reads the account from the database, and
 * attaches req.user.
 *
 * The DB read on every request is deliberate: a platform admin blocking a user
 * or suspending a company must take effect immediately, and an access token
 * lives for 15 minutes. It also means a role change applies at once — the role
 * and org attached to the request come from the row, never from the token.
 */
export const authenticate = asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    throw Unauthorized('Missing or malformed Authorization header');
  }

  let payload;
  try {
    payload = verifyAccessToken(header.slice(7));
  } catch {
    throw Unauthorized('Invalid or expired access token');
  }

  const account = await prisma.user.findUnique({
    where: { id: payload.sub },
    select: {
      id: true,
      email: true,
      role: true,
      isActive: true,
      organizationId: true,
      organization: { select: { status: true } },
    },
  });

  if (!account) throw Unauthorized('Account no longer exists');
  if (!account.isActive) throw Forbidden('This account has been blocked. Contact your administrator.');

  const platform = isPlatformRole(account.role);
  // A suspended tenant is frozen for its own members; platform admins keep
  // access so they can inspect and reinstate it.
  if (!platform && account.organization.status === 'SUSPENDED') {
    throw Forbidden('This company account is suspended. Contact support.');
  }

  req.user = {
    id: account.id,
    orgId: account.organizationId,
    role: account.role,
    email: account.email,
    isPlatformAdmin: platform,
  };
  next();
});

/** Guards a route by one of the listed roles. */
export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) throw Unauthorized();
    // Platform admins outrank every tenant role, so they satisfy any role guard.
    if (!req.user.isPlatformAdmin && !roles.includes(req.user.role)) {
      throw Forbidden(`Requires role: ${roles.join(', ')}`);
    }
    next();
  };
}

/** Guards a route by a permission from the RBAC matrix. */
export function requirePermission(permission: Permission) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) throw Unauthorized();
    if (!can(req.user.role, permission)) {
      throw Forbidden(`Missing permission: ${permission}`);
    }
    next();
  };
}

/** Guards the cross-tenant platform console. */
export function requirePlatformAdmin(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) throw Unauthorized();
  if (!req.user.isPlatformAdmin) throw Forbidden('Requires platform administrator access');
  next();
}
