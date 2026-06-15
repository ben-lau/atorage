import type { MiddlewareWithHooks, MiddlewareFunction } from '../types.js'

export interface CachedMiddleware extends MiddlewareWithHooks {
  clear(): void
}

export function cached(): CachedMiddleware {
  let cache: { value: unknown; meta: Record<string, unknown> } | null = null

  const handle: MiddlewareFunction = async (ctx, next) => {
    if (ctx.operation === 'get' && cache !== null) {
      ctx.value = cache.value
      Object.assign(ctx.meta, cache.meta)
      return
    }

    await next()

    if (ctx.operation === 'get') {
      cache = { value: ctx.value, meta: { ...ctx.meta } }
    } else if (ctx.operation === 'set') {
      cache = { value: ctx.value, meta: { ...ctx.meta } }
    } else if (ctx.operation === 'del') {
      cache = null
    }
  }

  return {
    handle,
    clear() {
      cache = null
    },
    onExternalChange() {
      cache = null
    },
    onDispose() {
      cache = null
    },
  }
}
