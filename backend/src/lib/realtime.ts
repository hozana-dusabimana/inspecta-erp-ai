import { Server as HttpServer } from 'http';
import { Server as IoServer } from 'socket.io';
import { verifyAccessToken } from './jwt';
import { env } from '../config/env';

let io: IoServer | null = null;

/** Attach a Socket.IO server that authenticates via the JWT access token and
 *  joins each client to a room scoped to its organization. */
export function initRealtime(httpServer: HttpServer): IoServer {
  io = new IoServer(httpServer, {
    cors: { origin: env.corsOrigin.split(',').map((s) => s.trim()), credentials: true },
  });

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token as string | undefined;
    if (!token) return next(new Error('Unauthorized'));
    try {
      const payload = verifyAccessToken(token);
      socket.data.orgId = payload.orgId;
      socket.data.userId = payload.sub;
      next();
    } catch {
      next(new Error('Unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    const orgId = socket.data.orgId as string;
    if (orgId) socket.join(`org:${orgId}`);
  });

  return io;
}

/** Emit an event to every connected client in an organization. */
export function emitToOrg(orgId: string, event: string, payload: unknown): void {
  io?.to(`org:${orgId}`).emit(event, payload);
}
