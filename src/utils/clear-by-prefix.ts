import type { Driver } from '../types.js'

export interface ClearByPrefixOptions {
  driver: Driver
}

export async function clearByPrefix(
  prefix: string,
  options: ClearByPrefixOptions,
): Promise<number> {
  const keys = await options.driver.keys(prefix)
  if (keys.length === 0) return 0

  if (options.driver.batch) {
    await options.driver.batch(
      keys.map((key) => ({ type: 'del', key })),
    )
  } else {
    for (const key of keys) {
      await options.driver.del(key)
    }
  }
  return keys.length
}
