import type { MiddlewareFunction } from '../types.js'

export class ValidationError extends Error {
  override name = 'ValidationError'
  constructor(key: string) {
    super(`Validation failed for key "${key}"`)
  }
}

export function validate(validator: (value: unknown) => boolean): MiddlewareFunction {
  return async (ctx, next) => {
    if (ctx.operation === 'set') {
      if (!validator(ctx.value)) {
        throw new ValidationError(ctx.key)
      }
    }

    await next()

    if (ctx.operation === 'get' && ctx.value !== undefined) {
      if (!validator(ctx.value)) {
        ctx.value = undefined
        ctx.reportError(new ValidationError(ctx.key))
      }
    }
  }
}
