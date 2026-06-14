import type { AtomModifier, Driver, Middleware, Scope } from './types.js'

export function withDriver<T = unknown>(
  driver: Driver | Driver[],
): AtomModifier<T> {
  const drivers = Array.isArray(driver) ? driver : [driver]
  return (config) => ({ ...config, drivers: [...config.drivers, ...drivers] })
}

export function withScope<T = unknown>(
  ...scopes: Scope[]
): AtomModifier<T> {
  return (config) => ({ ...config, scopes: [...config.scopes, ...scopes] })
}

export function withMiddleware<T = unknown>(
  ...mw: Middleware[]
): AtomModifier<T> {
  return (config) => ({ ...config, middleware: [...config.middleware, ...mw] })
}

export function withPreMiddleware<T = unknown>(
  ...mw: Middleware[]
): AtomModifier<T> {
  return (config) => ({
    ...config,
    preMiddleware: [...config.preMiddleware, ...mw],
  })
}
