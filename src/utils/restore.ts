import type { Driver } from '../types.js'

export interface RestoreOptions {
  driver: Driver
}

export async function restore(
  data: Record<string, unknown>,
  options: RestoreOptions,
): Promise<void> {
  const entries = Object.entries(data)
  if (entries.length === 0) return

  if (options.driver.batch) {
    await options.driver.batch(
      entries.map(([key, value]) => ({ type: 'set', key, value })),
    )
  } else {
    for (const [key, value] of entries) {
      await options.driver.set(key, value)
    }
  }
}
