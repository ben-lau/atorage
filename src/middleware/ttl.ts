import type { MiddlewareFunction } from '../types';

export interface TtlOptions {
  deleteOnExpire?: boolean;
}

export function ttl(duration: number, options?: TtlOptions): MiddlewareFunction {
  const deleteOnExpire = options?.deleteOnExpire ?? false;

  return async (ctx, next) => {
    if (ctx.operation === 'set') {
      ctx.meta.exp = Date.now() + duration;
    }

    await next();

    if (ctx.operation === 'get' || ctx.operation === 'has') {
      const exp = ctx.meta.exp;
      if (typeof exp === 'number' && exp <= Date.now()) {
        ctx.value = undefined;
        if (deleteOnExpire) {
          ctx.requestDelete();
        }
      }
    }
  };
}
