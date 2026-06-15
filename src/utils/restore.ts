import type { Driver } from '../types.js'

export interface RestoreOptions {
  driver: Driver
}

export async function restore(
  data: Record<string, unknown>,
  options: RestoreOptions,
): Promise<void> {
  for (const [key, value] of Object.entries(data)) {
    await options.driver.set(key, value)
  }
}
