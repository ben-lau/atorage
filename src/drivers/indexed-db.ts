import type { BatchOp, Driver } from '../types';

export interface IndexedDBDriverOptions {
  dbName?: string; // default: 'atorage'
  storeName?: string; // default: 'kv'
}

interface DbPoolEntry {
  db: IDBDatabase | null;
  holders: Set<object>;
  chain: Promise<unknown>;
}

const pools = new Map<string, DbPoolEntry>();

function getPool(dbName: string): DbPoolEntry {
  let entry = pools.get(dbName);
  if (!entry) {
    entry = { db: null, holders: new Set(), chain: Promise.resolve() };
    pools.set(dbName, entry);
  }
  return entry;
}

function enqueue<T>(dbName: string, task: () => Promise<T>): Promise<T> {
  const pool = getPool(dbName);
  const run = pool.chain.then(task, task);
  pool.chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function openRaw(
  dbName: string,
  version?: number,
  onUpgrade?: (db: IDBDatabase) => void,
): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request =
      version === undefined ? indexedDB.open(dbName) : indexedDB.open(dbName, version);

    request.onupgradeneeded = () => {
      onUpgrade?.(request.result);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'));
  });
}

function attachVersionChange(db: IDBDatabase, dbName: string): void {
  db.onversionchange = () => {
    db.close();
    const pool = pools.get(dbName);
    if (pool && pool.db === db) {
      pool.db = null;
    }
  };
}

async function ensureDb(dbName: string, storeName: string): Promise<IDBDatabase> {
  const pool = getPool(dbName);

  if (pool.db) {
    if (pool.db.objectStoreNames.contains(storeName)) {
      return pool.db;
    }
    pool.db.close();
    pool.db = null;
  }

  let db = await openRaw(dbName, undefined, (upgradeDb) => {
    if (!upgradeDb.objectStoreNames.contains(storeName)) {
      upgradeDb.createObjectStore(storeName);
    }
  });

  if (!db.objectStoreNames.contains(storeName)) {
    const nextVersion = db.version + 1;
    db.close();
    db = await openRaw(dbName, nextVersion, (upgradeDb) => {
      if (!upgradeDb.objectStoreNames.contains(storeName)) {
        upgradeDb.createObjectStore(storeName);
      }
    });
  }

  attachVersionChange(db, dbName);
  pool.db = db;
  return db;
}

export function indexedDBDriver(options?: IndexedDBDriverOptions): Driver {
  const dbName = options?.dbName ?? 'atorage';
  const storeName = options?.storeName ?? 'kv';
  const holder = {};
  let acquired = false;

  function getDB(): Promise<IDBDatabase> {
    const pool = getPool(dbName);
    if (acquired && pool.db && pool.db.objectStoreNames.contains(storeName)) {
      return Promise.resolve(pool.db);
    }
    return enqueue(dbName, async () => {
      const db = await ensureDb(dbName, storeName);
      if (!acquired) {
        getPool(dbName).holders.add(holder);
        acquired = true;
      }
      return db;
    });
  }

  function tx(mode: IDBTransactionMode): Promise<IDBObjectStore> {
    return getDB().then((db) => {
      const transaction = db.transaction(storeName, mode);
      return transaction.objectStore(storeName);
    });
  }

  function req<T>(request: IDBRequest<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  return {
    name: 'indexedDB',
    backendId: `indexedDB:${dbName}/${storeName}`,

    available() {
      return typeof indexedDB !== 'undefined';
    },

    async get(key) {
      const store = await tx('readonly');
      const value = await req(store.get(key));
      return value === undefined ? undefined : value;
    },

    async set(key, value) {
      const store = await tx('readwrite');
      await req(store.put(value, key));
    },

    async del(key) {
      const store = await tx('readwrite');
      await req(store.delete(key));
    },

    async has(key) {
      const store = await tx('readonly');
      const count = await req(store.count(key));
      return count > 0;
    },

    async keys(prefix?) {
      const store = await tx('readonly');
      const allKeys = await req(store.getAllKeys());
      const stringKeys = allKeys.filter((k): k is string => typeof k === 'string');
      if (prefix === undefined) return stringKeys;
      return stringKeys.filter((k) => k.startsWith(prefix));
    },

    async dispose() {
      // Drop interest synchronously so concurrent get/set cannot take the
      // fast path on a connection this dispose is about to close.
      const wasAcquired = acquired;
      acquired = false;
      await enqueue(dbName, async () => {
        const pool = getPool(dbName);
        if (wasAcquired) {
          pool.holders.delete(holder);
        }
        if (pool.holders.size === 0 && pool.db) {
          pool.db.close();
          pool.db = null;
        }
      });
    },

    async batch(ops: BatchOp[]) {
      const db = await getDB();
      return new Promise<void>((resolve, reject) => {
        const transaction = db.transaction(storeName, 'readwrite');
        const store = transaction.objectStore(storeName);
        for (const op of ops) {
          if (op.type === 'set') {
            store.put(op.value, op.key);
          } else {
            store.delete(op.key);
          }
        }
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
      });
    },
  };
}
