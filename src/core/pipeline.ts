import type { Middleware, MiddlewareContext, MiddlewareFunction } from '../types.js'

function getHandler(mw: Middleware): MiddlewareFunction {
  return typeof mw === 'function' ? mw : mw.handle
}

export async function executePipeline(
  middleware: Middleware[],
  ctx: MiddlewareContext,
  coreHandler: () => Promise<void>,
): Promise<void> {
  let next: () => Promise<void> = coreHandler

  for (let i = middleware.length - 1; i >= 0; i--) {
    const handler = getHandler(middleware[i])
    const innerNext = next
    next = () => handler(ctx, innerNext)
  }

  await next()
}
