import { Request, Response, NextFunction, RequestHandler } from 'express';

/** Wraps an async route handler so thrown errors reach the error middleware. */
export const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };

export function ok(res: Response, data: unknown, status = 200) {
  return res.status(status).json({ success: true, data });
}

export function paginated(
  res: Response,
  data: unknown[],
  meta: { page: number; pageSize: number; total: number; sums?: Record<string, number> },
) {
  return res.status(200).json({ success: true, data, meta });
}
