import type { Driver } from '../types.js'
import { StorageError } from '../errors.js'

export async function degradedGet(
  drivers: Driver[],
  key: string,
): Promise<unknown> {
  const errors: Error[] = []
  for (const driver of drivers) {
    try {
      const stored = await driver.get(key)
      if (stored !== undefined) {
        return stored
      }
    } catch (err) {
      errors.push(err instanceof Error ? err : new Error(String(err)))
    }
  }
  if (errors.length > 0 && errors.length === drivers.length) {
    throw new StorageError('All drivers failed on get', errors)
  }
  return undefined
}

export async function degradedSet(
  drivers: Driver[],
  key: string,
  value: unknown,
): Promise<void> {
  const errors: Error[] = []
  for (let i = 0; i < drivers.length; i++) {
    try {
      await drivers[i].set(key, value)
      for (let j = 0; j < drivers.length; j++) {
        if (j !== i) {
          await drivers[j].del(key).catch(() => {})
        }
      }
      return
    } catch (err) {
      errors.push(err instanceof Error ? err : new Error(String(err)))
    }
  }
  throw new StorageError('All drivers failed on set', errors)
}

export async function degradedDel(
  drivers: Driver[],
  key: string,
): Promise<void> {
  for (const driver of drivers) {
    await driver.del(key).catch(() => {})
  }
}
