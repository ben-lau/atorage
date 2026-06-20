import { atom } from '../../src/atom';
import { defineAtom } from '../../src/define-atom';
import { batch } from '../../src/batch';
import { withDriver, withScope, withMiddleware } from '../../src/modifiers';
import { createScope } from '../../src/scope';
import { memoryDriver } from '../../src/drivers/memory';
import { validate } from '../../src/middleware/validate';
import { ttl } from '../../src/middleware/ttl';
import { versioned } from '../../src/middleware/versioned';
import { cached } from '../../src/middleware/cached';
import { snapshot, restore, clearByPrefix } from '../../src/utils/index';
import { inspect } from '../../src/debug/inspect';
import { eventBus } from '../../src/core/event-bus';

describe('recommended patterns', () => {
  afterEach(() => {
    eventBus._clear();
  });

  describe('defineAtom factory pattern', () => {
    it('each atom gets independent stateful middleware instances', async () => {
      const driver = memoryDriver();

      const createAtom = defineAtom(() => [withDriver(driver), withMiddleware(cached())]);

      const a = createAtom<string>('key-a');
      const b = createAtom<string>('key-b');

      await a.set('value-a');
      await b.set('value-b');

      // each reads its own value, caches do not pollute each other
      expect(await a.get()).toBe('value-a');
      expect(await b.get()).toBe('value-b');

      a.dispose();
      b.dispose();
    });

    it('factory function receives key for dynamic configuration', async () => {
      const driver = memoryDriver();

      const createAtom = defineAtom((key) => [
        withDriver(driver),
        withMiddleware(
          cached(),
          // dynamically determine TTL based on key
          ttl(key.startsWith('temp:') ? 1000 : 60000),
        ),
      ]);

      vi.useFakeTimers();
      vi.setSystemTime(0);

      const temp = createAtom<string>('temp:data');
      const perm = createAtom<string>('perm:data');

      await temp.set('short-lived');
      await perm.set('long-lived');

      vi.advanceTimersByTime(2000);

      // temp expired
      const tempCacheMw = cached();
      const tempAtom2 = atom<string>(
        'temp:data',
        withDriver(driver),
        withMiddleware(tempCacheMw, ttl(1000)),
      );
      expect(await tempAtom2.get()).toBeUndefined();

      // perm still valid
      expect(await perm.get()).toBe('long-lived');

      vi.useRealTimers();
      temp.dispose();
      perm.dispose();
      tempAtom2.dispose();
    });
  });

  describe('recommended middleware stack', () => {
    it('validate -> ttl -> versioned -> cached stack works correctly', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(0);

      const driver = memoryDriver();
      const isObject = (v: unknown) => typeof v === 'object' && v !== null;

      const a = atom<{ name: string; v2?: boolean }>(
        'config',
        withDriver(driver),
        withMiddleware(
          validate(isObject),
          ttl(5000),
          versioned({ current: 2, migrate: { 1: (d: any) => ({ ...d, v2: true }) } }),
          cached(),
        ),
      );

      // normal write
      await a.set({ name: 'test' });
      expect(await a.get()).toEqual({ name: 'test' });

      // validate rejects non-object
      await expect(a.set('invalid' as any)).rejects.toThrow();

      // TTL expired
      vi.advanceTimersByTime(6000);
      // cached would hit, but ttl is outer so need fresh cache
      const a2 = atom<{ name: string; v2?: boolean }>(
        'config',
        withDriver(driver),
        withMiddleware(validate(isObject), ttl(5000), cached()),
      );
      expect(await a2.get()).toBeUndefined();

      vi.useRealTimers();
      a.dispose();
      a2.dispose();
    });
  });

  describe('batch operations', () => {
    it('multiple writes in batch fire events only once at the end', async () => {
      const driver = memoryDriver();
      const a = atom<number>('counter', withDriver(driver));

      const changes: number[] = [];
      a.addEventListener('change', ((e: CustomEvent) => {
        changes.push(e.detail.value);
      }) as unknown as EventListener);

      await batch(async () => {
        await a.set(1);
        await a.set(2);
        await a.set(3);
      });

      // three sets in batch, but change events coalesce to the last value
      expect(changes).toEqual([3]);
      expect(await a.get()).toBe(3);

      a.dispose();
    });

    it('multi-atom batch fires all events after batch completes', async () => {
      const driver = memoryDriver();
      const a = atom<string>('a', withDriver(driver));
      const b = atom<string>('b', withDriver(driver));

      const events: string[] = [];
      a.addEventListener('change', () => events.push('a-change'));
      b.addEventListener('change', () => events.push('b-change'));

      await batch(async () => {
        await a.set('alpha');
        await b.set('beta');
        // batch in progress, no events fired yet
        expect(events).toEqual([]);
      });

      // events fired after batch completes
      expect(events).toContain('a-change');
      expect(events).toContain('b-change');

      a.dispose();
      b.dispose();
    });
  });

  describe('snapshot + restore data migration', () => {
    it('migrates data from one driver to another', async () => {
      const source = memoryDriver();
      const target = memoryDriver();

      // write data to source
      const a = atom<string>('user:name', withDriver(source));
      const b = atom<number>('user:age', withDriver(source));
      await a.set('Alice');
      await b.set(30);
      a.dispose();
      b.dispose();

      // snapshot -> restore
      const data = await snapshot({ driver: source, prefix: 'user:' });
      await restore(data, { driver: target });

      // read from target to verify
      const a2 = atom<string>('user:name', withDriver(target));
      const b2 = atom<number>('user:age', withDriver(target));
      expect(await a2.get()).toBe('Alice');
      expect(await b2.get()).toBe(30);

      a2.dispose();
      b2.dispose();
    });
  });

  describe('clearByPrefix bulk cleanup', () => {
    it('clears all data with the given prefix', async () => {
      const driver = memoryDriver();

      const a1 = atom<string>('cache:page1', withDriver(driver));
      const a2 = atom<string>('cache:page2', withDriver(driver));
      const a3 = atom<string>('settings:theme', withDriver(driver));

      await a1.set('page1-data');
      await a2.set('page2-data');
      await a3.set('dark');

      a1.dispose();
      a2.dispose();
      a3.dispose();

      const count = await clearByPrefix('cache:', { driver });
      expect(count).toBe(2);

      // cache data cleared
      expect(await driver.get('cache:page1')).toBeUndefined();
      expect(await driver.get('cache:page2')).toBeUndefined();

      // settings data unaffected
      expect(await driver.get('settings:theme')).toBeDefined();
    });
  });

  describe('inspect debug tool', () => {
    it('inspects raw driver state after atom write', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(1000);

      const driver = memoryDriver();
      const a = atom<string>('debug-key', withDriver(driver), withMiddleware(ttl(5000)));

      await a.set('debug-value');

      const info = await inspect(driver, 'debug-key');
      expect(info.exists).toBe(true);
      expect(info.value).toBe('debug-value');
      expect(info.meta.exp).toBe(6000); // 1000 + 5000

      vi.useRealTimers();
      a.dispose();
    });

    it('returns exists=false for nonexistent key', async () => {
      const driver = memoryDriver();
      const info = await inspect(driver, 'nonexistent');
      expect(info.exists).toBe(false);
      expect(info.value).toBeUndefined();
    });
  });

  describe('multiple atoms sharing a driver', () => {
    it('different-key atoms share one driver without interference', async () => {
      const driver = memoryDriver();

      const a = atom<string>('users:alice', withDriver(driver));
      const b = atom<string>('users:bob', withDriver(driver));
      const c = atom<number>('counter', withDriver(driver));

      await a.set('Alice');
      await b.set('Bob');
      await c.set(42);

      expect(await a.get()).toBe('Alice');
      expect(await b.get()).toBe('Bob');
      expect(await c.get()).toBe(42);

      await a.del();
      expect(await a.has()).toBe(false);
      expect(await b.get()).toBe('Bob');
      expect(await c.get()).toBe(42);

      a.dispose();
      b.dispose();
      c.dispose();
    });
  });

  describe('scope management', () => {
    it('scope bound to multiple atoms clears all on clear()', async () => {
      const driver = memoryDriver();
      const appScope = createScope('app');

      const atoms = Array.from({ length: 5 }, (_, i) =>
        atom<string>(`item-${i}`, withDriver(driver), withScope(appScope)),
      );

      await Promise.all(atoms.map((a, i) => a.set(`value-${i}`)));

      for (const a of atoms) {
        expect(await a.has()).toBe(true);
      }

      await appScope.clear();

      for (const a of atoms) {
        expect(await a.has()).toBe(false);
      }

      atoms.forEach((a) => a.dispose());
    });

    it('atoms in different scopes do not affect each other', async () => {
      const driver = memoryDriver();
      const authScope = createScope('auth');
      const cacheScope = createScope('cache');

      const token = atom<string>('token', withDriver(driver), withScope(authScope));
      const page = atom<string>('page-data', withDriver(driver), withScope(cacheScope));

      await token.set('auth-token-value1');
      await page.set('cached-page-data');

      // clearing cache scope does not affect auth scope
      await cacheScope.clear();

      expect(await page.has()).toBe(false);
      expect(await token.get()).toBe('auth-token-value1');

      token.dispose();
      page.dispose();
    });

    it('no eventBus registration leak after dispose', async () => {
      const driver = memoryDriver();
      const key = 'leak-test';

      // create and dispose 100 atoms with the same key
      for (let i = 0; i < 100; i++) {
        const a = atom<number>(key, withDriver(driver));
        await a.set(i);
        a.dispose();
      }

      // create a new one, write should work normally
      const final = atom<number>(key, withDriver(driver));
      await final.set(999);
      expect(await final.get()).toBe(999);

      final.dispose();
    });
  });
});
