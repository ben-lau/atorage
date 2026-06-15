import type { Driver } from '../types.js'

export interface ClearByPrefixOptions {
  driver: Driver
}

export async function clearByPrefix(
  prefix: string,
  options: ClearByPrefixOptions,
): Promise<number> {
  const keys = await options.driver.keys(prefix)
  for (const key of keys) {
    await options.driver.del(key)
  }
  return keys.length
}
