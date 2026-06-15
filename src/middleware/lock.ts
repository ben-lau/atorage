import { AsyncMutex } from '../core/mutex.js'
import type { MiddlewareFunction } from '../types.js'

export function lock(): MiddlewareFunction {
  const mutex = new AsyncMutex()

  return async (_ctx, next) => {
    await mutex.run(() => next())
  }
}
