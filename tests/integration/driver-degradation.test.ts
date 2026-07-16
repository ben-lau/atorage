import { atom } from '../../src/atom';
import { withDriver } from '../../src/modifiers';
import { memoryDriver } from '../../src/drivers/memory';
import { StorageError } from '../../src/errors';
import type { Driver } from '../../src/types';

function createFlakyDriver(
  name: string,
  failPattern: { get?: boolean; set?: boolean; del?: boolean },
): Driver & { store: Map<string, unknown> } {
  const store = new Map<string, unknown>();
  return {
    name,
    store,
    async get(key) {
      if (failPattern.get) throw new Error(`${name} get failed`);
      return store.get(key);
    },
    async set(key, value) {
      if (failPattern.set) throw new Error(`${name} set failed`);
      store.set(key, value);
    },
    async del(key) {
      if (failPattern.del) throw new Error(`${name} del failed`);
      store.delete(key);
    },
    async has(key) {
      return store.has(key);
    },
    async keys() {
      return [...store.keys()];
    },
    async dispose() {
      store.clear();
    },
  };
}

describe('Scenario: driver degradation under real conditions', () => {
  describe('Automatic degradation on primary driver failure', () => {
    it('primary driver set failure → automatic fallback to backup driver', async () => {
      const primary = createFlakyDriver('primary', { set: true });
      const fallback = memoryDriver();
      const a = atom<string>('key', withDriver([primary, fallback]));

      await a.set('important-data');

      // Data stored in fallback
      expect(await fallback.get('key')).toEqual({ $v: 'important-data' });
      // Not in primary
      expect(primary.store.has('key')).toBe(false);

      a.dispose();
    });

    it('primary driver get failure but has data → read from backup driver', async () => {
      const primary = createFlakyDriver('primary', { get: true });
      const fallback = memoryDriver();
      const a = atom<string>('key', withDriver([primary, fallback]));

      // Put data directly into fallback
      await fallback.set('key', { $v: 'from-fallback' });

      // primary.get throws → degradedGet skips and tries fallback
      const result = await a.get();
      expect(result).toBe('from-fallback');

      a.dispose();
    });

    it('all drivers get failure → throw StorageError', async () => {
      const d1 = createFlakyDriver('d1', { get: true });
      const d2 = createFlakyDriver('d2', { get: true });
      const a = atom<string>('key', withDriver([d1, d2]));

      await expect(a.get()).rejects.toThrow(/All drivers failed on get/);

      a.dispose();
    });

    it('all drivers set failure → throw StorageError containing all errors', async () => {
      const d1 = createFlakyDriver('d1', { set: true });
      const d2 = createFlakyDriver('d2', { set: true });
      const a = atom<string>('key', withDriver([d1, d2]));

      try {
        await a.set('doomed');
        expect.fail('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(StorageError);
        const se = err as StorageError;
        expect(se.errors!.length).toBe(2);
        expect(se.errors![0].message).toBe('d1 set failed');
        expect(se.errors![1].message).toBe('d2 set failed');
      }

      a.dispose();
    });

    it('del failure on one driver is silently ignored, does not affect overall', async () => {
      const primary = memoryDriver();
      const flaky = createFlakyDriver('flaky', { del: true });
      const a = atom<string>('key', withDriver([primary, flaky]));

      await a.set('value');
      // del should succeed (degradedDel ignores individual driver errors)
      await expect(a.del()).resolves.toBeUndefined();

      a.dispose();
    });
  });

  describe('Data consistency after degradation', () => {
    it('successful degraded set clears old data from other drivers', async () => {
      const primary = createFlakyDriver('primary', { set: true });
      const fallback = memoryDriver();

      // Put old data in primary first
      primary.store.set('key', { $v: 'old-in-primary' });

      const a = atom<string>('key', withDriver([primary, fallback]));

      await a.set('new-data');
      // After degraded write to fallback, should attempt to clear primary's old data
      // degradedSet logic: after successful write to driver i, del from other drivers
      // But primary.del may also fail (we didn't set del: true here)
      expect(primary.store.has('key')).toBe(false);

      a.dispose();
    });

    it('get after degraded write reads from the correct driver', async () => {
      const primary = createFlakyDriver('primary', { set: true });
      const fallback = memoryDriver();
      const a = atom<string>('key', withDriver([primary, fallback]));

      await a.set('fallback-data');

      // get tries by priority: primary.get(undefined) → fallback.get(has data)
      const result = await a.get();
      expect(result).toBe('fallback-data');

      a.dispose();
    });

    it('after primary recovers, new set writes back to primary and clears old fallback data', async () => {
      let primaryFailing = true;
      const store = new Map<string, unknown>();
      const dynamic: Driver = {
        name: 'dynamic',
        async get(key) {
          return store.get(key);
        },
        async set(key, value) {
          if (primaryFailing) throw new Error('down');
          store.set(key, value);
        },
        async del(key) {
          store.delete(key);
        },
        async has(key) {
          return store.has(key);
        },
        async keys() {
          return [...store.keys()];
        },
        async dispose() {
          store.clear();
        },
      };
      const fallback = memoryDriver();
      const a = atom<string>('key', withDriver([dynamic, fallback]));

      // Primary fails, degrade write to fallback
      await a.set('during-outage');
      expect(await fallback.get('key')).toEqual({ $v: 'during-outage' });

      // Primary recovers
      primaryFailing = false;
      await a.set('recovered');

      // Should write to primary
      expect(store.get('key')).toEqual({ $v: 'recovered' });
      // Old data in fallback is cleared
      expect(await fallback.get('key')).toBeUndefined();

      a.dispose();
    });
  });

  describe('Dynamic driver available() detection', () => {
    it('driver with available() returning false at construction is permanently filtered', async () => {
      const unavailable: Driver = {
        name: 'unavailable',
        available: () => false,
        async get() {
          return 'should-not-reach';
        },
        async set() {},
        async del() {},
        async has() {
          return true;
        },
        async keys() {
          return [];
        },
        async dispose() {},
      };
      const fallback = memoryDriver();
      const a = atom<string>('key', withDriver([unavailable, fallback]));

      await a.set('data');
      // unavailable is filtered, so data is in fallback
      expect(await fallback.get('key')).toEqual({ $v: 'data' });

      // get does not read from unavailable
      const result = await a.get();
      expect(result).toBe('data');

      a.dispose();
    });

    it('driver with available() throwing an exception is treated as unavailable', async () => {
      const explosive: Driver = {
        name: 'explosive',
        available: () => {
          throw new Error('quota exceeded');
        },
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
      const fallback = memoryDriver();
      const a = atom<string>('key', withDriver([explosive, fallback]));

      await a.set('safe');
      expect(await a.get()).toBe('safe');

      a.dispose();
    });

    it('driver with available() returning a rejected Promise is treated as unavailable', async () => {
      const broken: Driver = {
        name: 'broken',
        available: () => Promise.reject(new Error('not supported')),
        async get() {
          return 'ghost';
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
      const fallback = memoryDriver();
      const a = atom<string>('key', withDriver([broken, fallback]));

      await a.set('real');
      expect(await a.get()).toBe('real');

      a.dispose();
    });

    it('driver without available method is treated as available by default', async () => {
      const bare: Driver = {
        name: 'bare',
        async get(_key) {
          return undefined;
        },
        async set(_key, _value) {},
        async del(_key) {},
        async has(_key) {
          return false;
        },
        async keys() {
          return [];
        },
        async dispose() {},
      };
      const a = atom<string>('key', withDriver(bare));

      // Should not throw
      await expect(a.set('ok')).resolves.toBeUndefined();

      a.dispose();
    });
  });

  describe('Edge cases', () => {
    it('behavior of all operations when there are zero drivers', async () => {
      const a = atom<string>(
        'key',
        withDriver({
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
        }),
      );

      // All operations throw StorageError with clear message
      await expect(a.get()).rejects.toThrow(/no available drivers/);
      await expect(a.has()).rejects.toThrow(/no available drivers/);
      await expect(a.set('value')).rejects.toThrow(/no available drivers/);
      await expect(a.del()).rejects.toThrow(/no available drivers/);

      a.dispose();
    });

    it('driver set crashes after write but before clearing old data', async () => {
      const primary = memoryDriver();
      let delShouldFail = false;
      const secondary: Driver = {
        name: 'secondary',
        async get(_key) {
          return undefined;
        },
        async set(_key, _value) {},
        async del(_key) {
          if (delShouldFail) throw new Error('cleanup failed');
        },
        async has(_key) {
          return false;
        },
        async keys() {
          return [];
        },
        async dispose() {},
      };

      const a = atom<string>('key', withDriver([primary, secondary]));

      delShouldFail = true;
      // After primary.set succeeds, secondary.del is attempted
      // degradedSet's del catch silently ignores the error
      await expect(a.set('data')).resolves.toBeUndefined();
      expect(await a.get()).toBe('data');

      a.dispose();
    });

    it('driver becomes unavailable mid-operation (runtime failure)', async () => {
      let failing = false;
      const store = new Map<string, unknown>();
      const unreliable: Driver = {
        name: 'unreliable',
        async get(key) {
          if (failing) throw new Error('runtime failure');
          return store.get(key);
        },
        async set(key, value) {
          if (failing) throw new Error('runtime failure');
          store.set(key, value);
        },
        async del(key) {
          store.delete(key);
        },
        async has(key) {
          return store.has(key);
        },
        async keys() {
          return [...store.keys()];
        },
        async dispose() {
          store.clear();
        },
      };

      const a = atom<string>('key', withDriver(unreliable));

      await a.set('ok');
      expect(await a.get()).toBe('ok');

      // Driver runtime failure (single driver, all failures throw)
      failing = true;
      await expect(a.set('fail')).rejects.toThrow();
      await expect(a.get()).rejects.toThrow(/All drivers failed/);

      // Recover
      failing = false;
      expect(await a.get()).toBe('ok');

      a.dispose();
    });

    it('driver load under high-frequency set (stress test)', async () => {
      const driver = memoryDriver();
      const a = atom<number>('counter', withDriver(driver));

      const ops = Array.from({ length: 1000 }, (_, i) => a.set(i));
      await Promise.all(ops);

      const final = await a.get();
      expect(typeof final).toBe('number');
      expect(final).toBeGreaterThanOrEqual(0);
      expect(final).toBeLessThan(1000);

      a.dispose();
    });
  });

  describe('Multi-driver read priority', () => {
    it('first driver with value does not read subsequent drivers', async () => {
      let secondRead = false;
      const primary = memoryDriver();
      const secondary: Driver = {
        name: 'tracked-secondary',
        async get() {
          secondRead = true;
          return { $v: 'secondary' };
        },
        async set() {},
        async del() {},
        async has() {
          return true;
        },
        async keys() {
          return [];
        },
        async dispose() {},
      };

      const a = atom<string>('key', withDriver([primary, secondary]));
      await primary.set('key', { $v: 'primary' });

      const result = await a.get();
      expect(result).toBe('primary');
      expect(secondRead).toBe(false);

      a.dispose();
    });

    it('first driver returning undefined continues to read the next one', async () => {
      const empty = memoryDriver();
      const hasData = memoryDriver();
      await hasData.set('key', { $v: 'found-in-second' });

      const a = atom<string>('key', withDriver([empty, hasData]));

      expect(await a.get()).toBe('found-in-second');

      a.dispose();
    });

    it('null is a valid value and does not fall through to the next driver', async () => {
      const primary = memoryDriver();
      await primary.set('key', { $v: null });

      const secondary = memoryDriver();
      await secondary.set('key', { $v: 'should-not-reach' });

      const a = atom<string | null>('key', withDriver([primary, secondary]));

      // After wrap, stored = { $v: null }
      // degradedGet: stored !== undefined → return
      // unwrap: { $v: null } → value = null
      expect(await a.get()).toBeNull();

      a.dispose();
    });
  });
});
