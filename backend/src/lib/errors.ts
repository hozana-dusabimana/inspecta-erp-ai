export class AppError extends Error {
  statusCode: number;
  details?: unknown;

  constructor(statusCode: number, message: string, details?: unknown) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

export const BadRequest = (msg = 'Bad request', details?: unknown) =>
  new AppError(400, msg, details);
export const Unauthorized = (msg = 'Unauthorized') => new AppError(401, msg);
export const Forbidden = (msg = 'Forbidden') => new AppError(403, msg);
export const NotFound = (msg = 'Not found') => new AppError(404, msg);
/** 402 — the tenant's subscription has lapsed; reads still work, writes do not. */
export const PaymentRequired = (msg = 'Subscription required') => new AppError(402, msg);

export const Conflict = (msg = 'Conflict') => new AppError(409, msg);
