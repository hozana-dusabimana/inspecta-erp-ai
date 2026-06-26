import { Request, Response, NextFunction } from 'express';
import { Role } from '@prisma/client';
import { verifyAccessToken } from '../lib/jwt';
import { Unauthorized, Forbidden } from '../lib/errors';
import { can, Permission } from '../auth/permissions';

export interface AuthUser {
  id: string;
  orgId: string;
  role: Role;
  email: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

/** Verifies the Bearer access token and attaches req.user. */
export function authenticate(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    throw Unauthorized('Missing or malformed Authorization header');
  }
  const token = header.slice(7);
  try {
    const payload = verifyAccessToken(token);
    req.user = {
      id: payload.sub,
      orgId: payload.orgId,
      role: payload.role,
      email: payload.email,
    };
    next();
  } catch {
    throw Unauthorized('Invalid or expired access token');
  }
}

/** Guards a route by one of the listed roles. */
export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) throw Unauthorized();
    if (!roles.includes(req.user.role)) {
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
