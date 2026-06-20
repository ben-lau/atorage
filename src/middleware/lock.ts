import { AsyncMutex } from '../core/mutex';
import type { MiddlewareFunction } from '../types';

export function lock(): MiddlewareFunction {
  const mutex = new AsyncMutex();

  return async (_ctx, next) => {
    await mutex.run(() => next());
  };
}
