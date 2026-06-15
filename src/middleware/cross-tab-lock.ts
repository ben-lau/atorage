import type { MiddlewareFunction } from '../types.js'

export function crossTabLock(): MiddlewareFunction {
  return async (ctx, next) => {
    if (
      (ctx.operation === 'set' || ctx.operation === 'del') &&
      typeof navigator !== 'undefined' && navigator.locks
    ) {
      const lockName = `atorage:${ctx.key}`
      await navigator.locks.request(lockName, async () => {
        await next()
      })
    } else {
      await next()
    }
  }
}
