import type { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'node:crypto';
import type { Blocker } from './enums.js';

export class AppError extends Error {
  status: number;
  code: string;
  details?: unknown[];
  traceId?: string;
  constructor(status: number, code: string, message: string, details?: unknown[]) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
    this.name = 'AppError';
  }
}

export const notFound = (msg = '资源不存在或无权访问') => new AppError(404, 'NOT_FOUND', msg);
export const forbidden = (msg = '无权限') => new AppError(403, 'FORBIDDEN', msg);
export const badRequest = (msg = '参数错误', details?: unknown[]) => new AppError(400, 'BAD_REQUEST', msg, details);
export const conflict = (msg = '数据已被他人修改，请刷新后重试') => new AppError(409, 'CONCURRENCY_CONFLICT', msg);
export function validationError(blockers: Blocker[]) {
  return new AppError(422, 'VALIDATION_FAILED', blockers.map((b) => b.message).join('；'), blockers);
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  const traceId = randomUUID();
  if (err instanceof AppError) {
    err.traceId = traceId;
    res.status(err.status).json({ code: err.code, message: err.message, traceId, details: err.details });
    return;
  }
  // eslint-disable-next-line no-console
  console.error('[ERROR]', err);
  res.status(500).json({ code: 'INTERNAL', message: '服务器内部错误', traceId });
}

export function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
