import type { MiddlewareFunction } from '../types.js';

export interface CrossTabLockOptions {
  timeout?: number; // milliseconds, default: 5000
}

export function crossTabLock(options?: CrossTabLockOptions): MiddlewareFunction {
  const timeout = options?.timeout ?? 5000;

  return async (ctx, next) => {
    if (
      (ctx.operation === 'set' || ctx.operation === 'del') &&
      typeof navigator !== 'undefined' &&
      navigator.locks
    ) {
      const lockName = `atorage:${ctx.key}`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);

      try {
        await navigator.locks.request(lockName, { signal: controller.signal }, async () => {
          await next();
        });
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          throw new Error(`Cross-tab lock timeout after ${timeout}ms (key: "${ctx.key}")`);
        }
        throw err;
      } finally {
        clearTimeout(timer);
      }
    } else {
      await next();
    }
  };
}
