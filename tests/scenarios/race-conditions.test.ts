import { atom } from '../../src/atom';
import { batch } from '../../src/batch';
import { withDriver, withMiddleware } from '../../src/modifiers';
import { memoryDriver } from '../../src/drivers/memory';
import { debounce } from '../../src/middleware/debounce';
import { lock } from '../../src/middleware/lock';
import { ttl } from '../../src/middleware/ttl';
import type { Driver, MiddlewareFunction } from '../../src/types';

function slowDriver(delayMs: number): Driver {
  const store = new Map<string, unknown>();
  const delay = () => new Promise((r) => setTimeout(r, delayMs));
  return {
    name: 'slow',
    async get(key) {
      await delay();
      return store.get(key);
    },
    async set(key, value) {
      await delay();
      store.set(key, value);
    },
    async del(key) {
      await delay();
      store.delete(key);
    },
    async has(key) {
      await delay();
      return store.has(key);
    },
    async keys() {
      await delay();
      return [...store.keys()];
    },
    async dispose() {
      store.clear();
    },
  };
}

describe('Scenario: race conditions and concurrency', () => {
  describe('Lockless get/set races', () => {
    it('concurrent set without protection: final value depends on which driver.set runs last', async () => {
      const driver = slowDriver(10);
      const a = atom<number>('counter', withDriver(driver));

      // 10 concurrent sets - no lock middleware
      const results = await Promise.allSettled(Array.from({ length: 10 }, (_, i) => a.set(i)));

      const allFulfilled = results.every((r) => r.status === 'fulfilled');
      expect(allFulfilled).toBe(true);

      // Final value should be one of 0-9, but which one is non-deterministic
      const final = await a.get();
      expect(final).toBeGreaterThanOrEqual(0);
      expect(final).toBeLessThanOrEqual(9);

      a.dispose();
    });

    it('update() mutex only protects a single atom instance; two instances update still races', async () => {
      const driver = memoryDriver();
      const a1 = atom<number>('counter', withDriver(driver));
      const a2 = atom<number>('counter', withDriver(driver));

      await a1.set(0);

      // Both instances try to increment the same storage key
      // Each has its own mutex, so they don't serialize against each other
      const p1 = a1.update(async (prev) => {
        await new Promise((r) => setTimeout(r, 10));
        return (prev ?? 0) + 1;
      });
      const p2 = a2.update(async (prev) => {
        await new Promise((r) => setTimeout(r, 5));
        return (prev ?? 0) + 1;
      });

      await Promise.all([p1, p2]);

      const final = await a1.get();
      // Without cross-instance coordination, one increment is lost
      // Expected: 2 if properly coordinated, but likely 1 due to race
      // This test documents the architectural limitation
      expect(final).toBeLessThanOrEqual(2);
      expect(final).toBeGreaterThanOrEqual(1);

      a1.dispose();
      a2.dispose();
    });

    it('lock() middleware serializes concurrent operations on the same instance', async () => {
      const driver = slowDriver(5);
      const lockMw = lock();
      const a = atom<number>('serial', withDriver(driver), withMiddleware(lockMw));

      await a.set(0);

      const order: number[] = [];
      const ops = Array.from({ length: 5 }, (_, i) => a.set(i).then(() => order.push(i)));

      await Promise.all(ops);

      // With lock, operations execute in order of submission
      expect(order).toEqual([0, 1, 2, 3, 4]);
      expect(await a.get()).toBe(4);

      a.dispose();
    });
  });

  describe('Read-write timing interleaving', () => {
    it('get during set completion may return stale value', async () => {
      const driver = slowDriver(20);
      const a = atom<string>('key', withDriver(driver));

      await a.set('original');

      // Start a slow get
      const getPromise = a.get();
      // Immediately start a set
      const setPromise = a.set('updated');

      const [getResult] = await Promise.all([getPromise, setPromise]);

      // get started first on slow driver, should return 'original'
      // because it reads before set writes
      expect(getResult).toBe('original');

      // Subsequent get should see the updated value
      expect(await a.get()).toBe('updated');

      a.dispose();
    });

    it('concurrent has() and del() may produce inconsistent results', async () => {
      const driver = slowDriver(10);
      const a = atom<string>('key', withDriver(driver));

      await a.set('exists');

      const hasPromise = a.has();
      const delPromise = a.del();

      const [hasResult] = await Promise.all([hasPromise, delPromise]);

      // has() started before del() completed, so it might return true
      // even though the value is about to be deleted
      // This documents the non-atomic nature of concurrent operations
      expect(typeof hasResult).toBe('boolean');

      a.dispose();
    });
  });

  describe('Debounce races', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('get() during debounce returns pending value rather than driver real value', async () => {
      const driver = memoryDriver();
      const debounceMw = debounce(100);
      const a = atom<string>('key', withDriver(driver), withMiddleware(debounceMw));

      await driver.set('key', { $v: 'from-driver' });
      await a.set('pending-value');

      // get() during debounce should return the pending value
      const result = await a.get();
      expect(result).toBe('pending-value');

      // But driver still has old value
      const raw = (await driver.get('key')) as { $v: string };
      expect(raw.$v).toBe('from-driver');

      // After flush, driver should be updated
      await debounceMw.flush();
      const updated = (await driver.get('key')) as { $v: string };
      expect(updated.$v).toBe('pending-value');

      a.dispose();
    });

    it('set immediately after debounce flush triggers a new debounce cycle', async () => {
      const driver = memoryDriver();
      const debounceMw = debounce(50);
      const a = atom<string>('key', withDriver(driver), withMiddleware(debounceMw));

      await a.set('first');
      await debounceMw.flush();
      expect(((await driver.get('key')) as { $v: string }).$v).toBe('first');

      await a.set('second');
      // Before second flush, driver still has 'first'
      expect(((await driver.get('key')) as { $v: string }).$v).toBe('first');

      await debounceMw.flush();
      expect(((await driver.get('key')) as { $v: string }).$v).toBe('second');

      a.dispose();
    });

    it('dispose cancels pending debounce, driver never receives the value', async () => {
      const driver = memoryDriver();
      const debounceMw = debounce(100);
      const a = atom<string>('key', withDriver(driver), withMiddleware(debounceMw));

      await a.set('lost-value');
      a.dispose();

      vi.advanceTimersByTime(200);

      // Value should never reach the driver
      expect(await driver.get('key')).toBeUndefined();
    });
  });

  describe('Races within batch', () => {
    it('mixed update + set operations in batch produce correct final state', async () => {
      const driver = memoryDriver();
      const a = atom<number>('counter', withDriver(driver));

      await a.set(0);
      const events: string[] = [];
      a.addEventListener('change', () => events.push('change'));

      await batch(async () => {
        await a.update((prev) => (prev ?? 0) + 1); // 0 -> 1
        await a.set(100); // override to 100
        await a.update((prev) => (prev ?? 0) + 1); // 100 -> 101
      });

      expect(await a.get()).toBe(101);
      // Batch should coalesce to single event
      expect(events).toEqual(['change']);

      a.dispose();
    });

    it('multi-atom operations in batch: event detail carries correct final values', async () => {
      const driver = memoryDriver();
      const a1 = atom<number>('balance-a', withDriver(driver));
      const a2 = atom<number>('balance-b', withDriver(driver));

      await a1.set(100);
      await a2.set(100);

      const eventValues: { key: string; value: number }[] = [];
      a1.addEventListener('change', (e) => {
        eventValues.push({ key: 'a1', value: (e as CustomEvent).detail.value });
      });
      a2.addEventListener('change', (e) => {
        eventValues.push({ key: 'a2', value: (e as CustomEvent).detail.value });
      });

      // Transfer 50 from a1 to a2 in a batch
      await batch(async () => {
        await a1.set(50);
        await a2.set(150);
      });

      // Event detail is a reliable source of final values
      expect(eventValues).toContainEqual({ key: 'a1', value: 50 });
      expect(eventValues).toContainEqual({ key: 'a2', value: 150 });

      // After event fires, driver state is also consistent
      expect(await a1.get()).toBe(50);
      expect(await a2.get()).toBe(150);

      a1.dispose();
      a2.dispose();
    });

    it('throw inside batch does not roll back already-executed operations', async () => {
      const driver = memoryDriver();
      const a = atom<string>('key', withDriver(driver));

      await a.set('original');

      await expect(
        batch(async () => {
          await a.set('modified');
          throw new Error('rollback?');
        }),
      ).rejects.toThrow('rollback?');

      // Data was written, no rollback
      expect(await a.get()).toBe('modified');

      a.dispose();
    });
  });

  describe('Async race on driver available()', () => {
    it('when driver available() returns a Promise, operations must wait for ready', async () => {
      let resolveAvailable: () => void;
      const availablePromise = new Promise<boolean>((r) => {
        resolveAvailable = () => r(true);
      });
      const store = new Map<string, unknown>();

      const asyncDriver: Driver = {
        name: 'async-available',
        available: () => availablePromise,
        async get(key) {
          return store.get(key);
        },
        async set(key, value) {
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

      const a = atom<string>('key', withDriver(asyncDriver));

      // Start a set - it should wait for driver ready
      const setPromise = a.set('value');

      // Resolve available after small delay
      setTimeout(() => resolveAvailable!(), 10);

      await setPromise;
      expect(await a.get()).toBe('value');

      a.dispose();
    });

    it('driver filtered out when available() returns false leaves atom with no usable driver', async () => {
      const unavailable: Driver = {
        name: 'broken',
        available: () => false,
        get: () => Promise.resolve(undefined),
        set: () => Promise.resolve(),
        del: () => Promise.resolve(),
        has: () => Promise.resolve(false),
        keys: () => Promise.resolve([]),
        dispose: () => Promise.resolve(),
      };

      const a = atom<string>('key', withDriver(unavailable));

      // All drivers filtered out -> degradedSet should throw StorageError
      await expect(a.set('value')).rejects.toThrow();

      a.dispose();
    });
  });

  describe('Races caused by middleware', () => {
    it('eventual consistency under slow encrypt middleware with concurrent set', async () => {
      let callCount = 0;
      const slowEncrypt: MiddlewareFunction = async (ctx, next) => {
        if (ctx.operation === 'set') {
          callCount++;
          const n = callCount;
          await new Promise((r) => setTimeout(r, Math.random() * 20));
          ctx.meta.encrypted_by = `call-${n}`;
        }
        await next();
      };

      const driver = memoryDriver();
      const a = atom<string>('key', withDriver(driver), withMiddleware(slowEncrypt));

      await Promise.all([a.set('a'), a.set('b'), a.set('c')]);

      // Final value exists and is one of a/b/c
      const final = await a.get();
      expect(['a', 'b', 'c']).toContain(final);

      a.dispose();
    });

    it('ttl: expired get clears peek', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(0);

      const driver = memoryDriver();
      const a = atom<string>('key', withDriver(driver), withMiddleware(ttl(100)));

      await a.set('fresh');
      expect(a.peek()).toBe('fresh');
      expect(await a.get()).toBe('fresh');

      vi.advanceTimersByTime(200);

      expect(await a.get()).toBeUndefined();
      expect(a.peek()).toBeUndefined();

      vi.useRealTimers();
      a.dispose();
    });
  });
});
