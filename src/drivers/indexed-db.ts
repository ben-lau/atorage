import type { BatchOp, Driver } from '../types.js'

export interface IndexedDBDriverOptions {
  dbName?: string      // default: 'atorage'
  storeName?: string   // default: 'kv'
}

export function indexedDBDriver(options?: IndexedDBDriverOptions): Driver {
  const dbName = options?.dbName ?? 'atorage'
  const storeName = options?.storeName ?? 'kv'
  
  let dbPromise: Promise<IDBDatabase> | null = null

  function getDB(): Promise<IDBDatabase> {
    if (!dbPromise) {
      dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(dbName, 1)
        request.onupgradeneeded = () => {
          const db = request.result
          if (!db.objectStoreNames.contains(storeName)) {
            db.createObjectStore(storeName)
          }
        }
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
    }
    return dbPromise
  }

  function tx(mode: IDBTransactionMode): Promise<IDBObjectStore> {
    return getDB().then(db => {
      const transaction = db.transaction(storeName, mode)
      return transaction.objectStore(storeName)
    })
  }

  function req<T>(request: IDBRequest<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  }

  return {
    name: 'indexedDB',

    available() {
      return typeof indexedDB !== 'undefined'
    },

    async get(key) {
      const store = await tx('readonly')
      const value = await req(store.get(key))
      return value === undefined ? undefined : value
    },

    async set(key, value) {
      const store = await tx('readwrite')
      await req(store.put(value, key))
    },

    async del(key) {
      const store = await tx('readwrite')
      await req(store.delete(key))
    },

    async has(key) {
      const store = await tx('readonly')
      const count = await req(store.count(key))
      return count > 0
    },

    async keys(prefix?) {
      const store = await tx('readonly')
      const allKeys = await req(store.getAllKeys())
      const stringKeys = allKeys
        .filter((k): k is string => typeof k === 'string')
      if (prefix === undefined) return stringKeys
      return stringKeys.filter(k => k.startsWith(prefix))
    },

    async dispose() {
      if (dbPromise) {
        const db = await dbPromise
        db.close()
        dbPromise = null
      }
    },

    async batch(ops: BatchOp[]) {
      const db = await getDB()
      return new Promise<void>((resolve, reject) => {
        const transaction = db.transaction(storeName, 'readwrite')
        const store = transaction.objectStore(storeName)
        for (const op of ops) {
          if (op.type === 'set') {
            store.put(op.value, op.key)
          } else {
            store.delete(op.key)
          }
        }
        transaction.oncomplete = () => resolve()
        transaction.onerror = () => reject(transaction.error)
      })
    },
  }
}
