import { atom } from '../../src/atom';
import { withDriver } from '../../src/modifiers';
import { StorageError } from '../../src/errors';
import { eventBus } from '../../src/core/event-bus';
import type { Driver } from '../../src/types';

function unreliableDriver(
  name: string,
  opts: { failGet?: boolean; failSet?: boolean; failDel?: boolean } = {},
): Driver & { store: Map<string, unknown> } {
  const store = new Map<string, unknown>();
  return {
    name,
    store,
    async get(key) {
      if (opts.failGet) throw new Error(`${name}: get failed`);
      return store.get(key);
    },
    async set(key, value) {
      if (opts.failSet) throw new Error(`${name}: set failed`);
      store.set(key, value);
    },
    async del(key) {
      if (opts.failDel) throw new Error(`${name}: del failed`);
      store.delete(key);
    },
    async has(key) {
      return store.has(key);
    },
    async keys(prefix) {
      return [...store.keys()].filter((k) => !prefix || k.startsWith(prefix));
    },
    async dispose() {
      store.clear();
    },
  };
}

describe('offline resilience and degradation', () => {
  afterEach(() => {
    eventBus._clear();
  });

  describe('write degradation', () => {
    it('auto-degrades to backup when primary write fails', async () => {
      const primary = unreliableDriver('primary', { failSet: true });
      const backup = unreliableDriver('backup');

      const a = atom<string>('key', withDriver([primary, backup]));

      await a.set('important-data');
      expect(await a.get()).toBe('important-data');

      expect(backup.store.has('key')).toBe(true);
      expect(primary.store.has('key')).toBe(false);

      a.dispose();
    });

    it('reads from backup after degraded write succeeds', async () => {
      const primary = unreliableDriver('primary', { failSet: true });
      const backup = unreliableDriver('backup');

      const a = atom<string>('key', withDriver([primary, backup]));

      await a.set('fallback-data');

      a.dispose();
      const a2 = atom<string>('key', withDriver([primary, backup]));
      expect(await a2.get()).toBe('fallback-data');

      a2.dispose();
    });

    it('throws StorageError when all drivers fail to write', async () => {
      const d1 = unreliableDriver('d1', { failSet: true });
      const d2 = unreliableDriver('d2', { failSet: true });

      const a = atom<string>('key', withDriver([d1, d2]));

      await expect(a.set('doomed')).rejects.toThrow(StorageError);

      a.dispose();
    });

    it('StorageError includes errors from all drivers', async () => {
      const d1 = unreliableDriver('d1', { failSet: true });
      const d2 = unreliableDriver('d2', { failSet: true });

      const a = atom<string>('key', withDriver([d1, d2]));

      try {
        await a.set('doomed');
        expect.fail('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(StorageError);
        const se = err as StorageError;
        expect(se.errors!.length).toBe(2);
        expect(se.errors![0].message).toContain('d1');
        expect(se.errors![1].message).toContain('d2');
      }

      a.dispose();
    });
  });

  describe('read degradation', () => {
    it('returns backup data when primary read fails', async () => {
      const primary = unreliableDriver('primary', { failGet: true });
      const backup = unreliableDriver('backup');

      backup.store.set('key', { $v: 'backup-value' });

      const a = atom<string>('key', withDriver([primary, backup]));
      expect(await a.get()).toBe('backup-value');

      a.dispose();
    });

    it('returns undefined when primary fails and backup has no data', async () => {
      const primary = unreliableDriver('primary', { failGet: true });
      const backup = unreliableDriver('backup');

      const a = atom<string>('key', withDriver([primary, backup]));
      expect(await a.get()).toBeUndefined();

      a.dispose();
    });

    it('throws StorageError when all drivers fail to read', async () => {
      const d1 = unreliableDriver('d1', { failGet: true });
      const d2 = unreliableDriver('d2', { failGet: true });

      const a = atom<string>('key', withDriver([d1, d2]));

      await expect(a.get()).rejects.toThrow(StorageError);

      a.dispose();
    });
  });

  describe('primary recovery', () => {
    it('writes to primary after recovery', async () => {
      let primaryFailing = true;
      const primary: Driver & { store: Map<string, unknown> } = {
        name: 'primary',
        store: new Map(),
        async get(key) {
          if (primaryFailing) throw new Error('primary down');
          return this.store.get(key);
        },
        async set(key, value) {
          if (primaryFailing) throw new Error('primary down');
          this.store.set(key, value);
        },
        async del(key) {
          this.store.delete(key);
        },
        async has(key) {
          return this.store.has(key);
        },
        async keys() {
          return [...this.store.keys()];
        },
        async dispose() {
          this.store.clear();
        },
      };
      const backup = unreliableDriver('backup');

      const a = atom<string>('key', withDriver([primary, backup]));

      // primary down, degrades to backup
      await a.set('during-outage');
      expect(backup.store.has('key')).toBe(true);
      expect(primary.store.has('key')).toBe(false);

      // primary recovers
      primaryFailing = false;
      await a.set('after-recovery');

      // new data written to primary
      expect(primary.store.has('key')).toBe(true);

      a.dispose();
    });
  });

  describe('delete degradation', () => {
    it('partial driver delete failure does not block overall delete', async () => {
      const primary = unreliableDriver('primary', { failDel: true });
      const backup = unreliableDriver('backup');

      primary.store.set('key', { $v: 'data' });
      backup.store.set('key', { $v: 'data' });

      const a = atom<string>('key', withDriver([primary, backup]));

      await expect(a.del()).resolves.toBeUndefined();

      expect(backup.store.has('key')).toBe(false);

      a.dispose();
    });
  });

  describe('no available drivers', () => {
    it('throws clear error for all operations when no drivers available', async () => {
      const ghost: Driver = {
        name: 'ghost',
        available: () => false,
        async get() {
          return undefined;
        },
        async set() {},
        async del() {},
        async has() {
          return false;
        },
        async keys() {
          return [];
        },
        async dispose() {},
      };

      const a = atom<string>('key', withDriver(ghost));

      await expect(a.get()).rejects.toThrow(/no available drivers/);
      await expect(a.set('value')).rejects.toThrow(/no available drivers/);
      await expect(a.del()).rejects.toThrow(/no available drivers/);
      await expect(a.has()).rejects.toThrow(/no available drivers/);

      a.dispose();
    });
  });
});
