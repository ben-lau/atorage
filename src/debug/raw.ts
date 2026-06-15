import type { Driver } from '../types.js'

export const raw = {
  async get(driver: Driver, key: string): Promise<unknown> {
    return driver.get(key)
  },

  async set(driver: Driver, key: string, value: unknown): Promise<void> {
    return driver.set(key, value)
  },

  async del(driver: Driver, key: string): Promise<void> {
    return driver.del(key)
  },
}
