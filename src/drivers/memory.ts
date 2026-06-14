import type { BatchOp, Driver, StorageUsage } from '../types.js'

export function memoryDriver(): Driver {
  const store = new Map<string, unknown>()

  return {
    name: 'memory',

    get(key: string): Promise<unknown> {
      return Promise.resolve(store.get(key))
    },

    set(key: string, value: unknown): Promise<void> {
      store.set(key, value)
      return Promise.resolve()
    },

    del(key: string): Promise<void> {
      store.delete(key)
      return Promise.resolve()
    },

    has(key: string): Promise<boolean> {
      return Promise.resolve(store.has(key))
    },

    keys(prefix?: string): Promise<string[]> {
      const allKeys = [...store.keys()]
      if (prefix === undefined) {
        return Promise.resolve(allKeys)
      }
      return Promise.resolve(allKeys.filter((key) => key.startsWith(prefix)))
    },

    dispose(): Promise<void> {
      store.clear()
      return Promise.resolve()
    },

    batch(ops: BatchOp[]): Promise<void> {
      for (const op of ops) {
        if (op.type === 'set') {
          store.set(op.key, op.value)
        } else {
          store.delete(op.key)
        }
      }
      return Promise.resolve()
    },

    usage(): Promise<StorageUsage> {
      return Promise.resolve({ used: store.size })
    },
  }
}
