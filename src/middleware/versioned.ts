import type { MiddlewareFunction } from '../types.js'

export interface VersionedConfig {
  current: number
  migrate: Record<number, (data: any) => any>
}

export function versioned(config: VersionedConfig): MiddlewareFunction {
  return async (ctx, next) => {
    if (ctx.operation === 'set') {
      ctx.meta.ver = config.current
    }

    await next()

    if (ctx.operation === 'get' && ctx.value !== undefined) {
      const storedVer = typeof ctx.meta.ver === 'number' ? ctx.meta.ver : 0
      if (storedVer > config.current) {
        throw new Error(
          `Data version ${storedVer} is newer than current ${config.current} (key: "${ctx.key}"). Downgrade is not supported.`,
        )
      }
      if (storedVer < config.current) {
        let data = ctx.value
        for (let v = storedVer; v < config.current; v++) {
          if (config.migrate[v]) {
            data = config.migrate[v](data)
          } else {
            throw new Error(
              `Missing migration for version ${v} → ${v + 1} (key: "${ctx.key}")`,
            )
          }
        }
        ctx.value = data
        ctx.meta.ver = config.current
        ctx.requestWriteback()
      }
    }
  }
}
