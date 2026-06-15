import type { MiddlewareFunction } from '../types.js'

export interface LoggerOptions {
  log?: (message: string) => void
}

export function logger(options?: LoggerOptions): MiddlewareFunction {
  const log = options?.log ?? console.log
  return async (ctx, next) => {
    const start = performance.now()
    await next()
    const ms = (performance.now() - start).toFixed(2)
    log(`[atorage] ${ctx.operation} ${ctx.key} (${ms}ms)`)
  }
}
