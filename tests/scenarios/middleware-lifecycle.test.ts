import { atom } from '../../src/atom';
import { batch } from '../../src/batch';
import { withDriver, withMiddleware, withScope } from '../../src/modifiers';
import { createScope } from '../../src/scope';
import { memoryDriver } from '../../src/drivers/memory';
import { cached } from '../../src/middleware/cached';
import { debounce } from '../../src/middleware/debounce';
import { ttl } from '../../src/middleware/ttl';
import { versioned } from '../../src/middleware/versioned';
import { validate } from '../../src/middleware/validate';
import { lock } from '../../src/middleware/lock';
import { eventBus } from '../../src/core/event-bus';
import type { MiddlewareFunction, MiddlewareWithHooks } from '../../src/types';

describe('Scenario: middleware lifecycle and state management', () => {
  afterEach(() => {
    eventBus._clear();
  });

  describe('Practical impact of middleware ordering', () => {
    it('validate before ttl: expired data bypasses validation and returns undefined', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(0);

      const isString = (v: unknown) => typeof v === 'string';
      const a = atom<string>(
        'key',
        withDriver(memoryDriver()),
        withMiddleware(validate(isString), ttl(100)),
      );

      await a.set('valid');
      vi.advanceTimersByTime(200);

      // ttl runs after validate (onion model: ttl is closer to core)
      // get: validate-before -> ttl-before -> core -> ttl-after(sets undefined) -> validate-after
      // validate in after phase sees undefined, no error (only validates !== undefined)
      const result = await a.get();
      expect(result).toBeUndefined();

      vi.useRealTimers();
      a.dispose();
    });

    it('validate after ttl: expired data is cleared by ttl first, validate is unaware', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(0);

      const isString = (v: unknown) => typeof v === 'string';
      const a = atom<string>(
        'key',
        withDriver(memoryDriver()),
        withMiddleware(ttl(100), validate(isString)),
      );

      await a.set('valid');
      vi.advanceTimersByTime(200);

      // ttl runs after first (sets to undefined)
      // validate then runs after (sees undefined, skips validation)
      const result = await a.get();
      expect(result).toBeUndefined();

      vi.useRealTimers();
      a.dispose();
    });

    it('cached before validate: invalid data may be cached', async () => {
      const driver = memoryDriver();
      const isPositive = (v: unknown) => typeof v === 'number' && v > 0;
      const cacheMw = cached();

      const a = atom<number>(
        'key',
        withDriver(driver),
        withMiddleware(cacheMw, validate(isPositive)),
      );

      await a.set(42); // valid, cached
      expect(await a.get()).toBe(42); // cache hit

      // Directly modify driver with invalid value
      await driver.set('key', { $v: -1 });

      // Cache still hits old value 42, no validate error triggered
      expect(await a.get()).toBe(42);

      // Clear cache and re-read
      cacheMw.clear();
      // validate runs after cached, get path: cached(miss) -> validate -> core
      // Actual onion: cached-before -> validate-before -> core -> validate-after -> cached-after
      // validate-after detects -1 is invalid, sets to undefined
      expect(await a.get()).toBeUndefined();

      a.dispose();
    });

    it('lock + debounce combo: lock protects atomicity of debounce flush', async () => {
      vi.useFakeTimers();
      const driver = memoryDriver();
      const debounceMw = debounce(50);
      const a = atom<number>('key', withDriver(driver), withMiddleware(lock(), debounceMw));

      await a.set(1);
      await a.set(2);
      await a.set(3);

      // debounce only keeps the last one
      vi.advanceTimersByTime(100);
      await debounceMw.flush();

      expect(await a.get()).toBe(3);

      vi.useRealTimers();
      a.dispose();
    });
  });

  describe('Real upgrade scenarios with versioned middleware', () => {
    it('multi-version sequential upgrade v1 -> v2 -> v3', async () => {
      const driver = memoryDriver();

      // Simulate old data
      await driver.set('config', { $v: { theme: 'light' }, $m: { ver: 1 } });

      const a = atom<{ theme: string; fontSize: number; lang: string }>(
        'config',
        withDriver(driver),
        withMiddleware(
          versioned({
            current: 3,
            migrate: {
              1: (d: { theme: string }) => ({ ...d, fontSize: 14 }),
              2: (d: { theme: string; fontSize: number }) => ({ ...d, lang: 'en' }),
            },
          }),
        ),
      );

      const result = await a.get();
      expect(result).toEqual({ theme: 'light', fontSize: 14, lang: 'en' });

      // After writeback, driver should store upgraded data with new version number
      const raw = (await driver.get('config')) as { $v: unknown; $m: { ver: number } };
      expect(raw.$m.ver).toBe(3);

      a.dispose();
    });

    it('downgrade version (data newer than code) should throw a clear error', async () => {
      const driver = memoryDriver();
      await driver.set('key', { $v: 'future-data', $m: { ver: 5 } });

      const a = atom<string>(
        'key',
        withDriver(driver),
        withMiddleware(versioned({ current: 3, migrate: {} })),
      );

      await expect(a.get()).rejects.toThrow(/newer than current/);

      a.dispose();
    });

    it('missing intermediate version migration function should throw a clear error', async () => {
      const driver = memoryDriver();
      await driver.set('key', { $v: { old: true }, $m: { ver: 1 } });

      const a = atom(
        'key',
        withDriver(driver),
        withMiddleware(
          versioned({
            current: 3,
            migrate: {
              1: (d: any) => ({ ...d, v2: true }),
              // Missing version 2 -> 3 migration
            },
          }),
        ),
      );

      await expect(a.get()).rejects.toThrow(/Missing migration/);

      a.dispose();
    });

    it('migration function throwing an error propagates correctly', async () => {
      const driver = memoryDriver();
      await driver.set('key', { $v: { corrupt: true }, $m: { ver: 1 } });

      const a = atom(
        'key',
        withDriver(driver),
        withMiddleware(
          versioned({
            current: 2,
            migrate: {
              1: () => {
                throw new Error('migration crashed');
              },
            },
          }),
        ),
      );

      await expect(a.get()).rejects.toThrow('migration crashed');

      a.dispose();
    });
  });

  describe('Middleware onExternalChange and cache consistency', () => {
    it('dual instances with cached on same key: one set should invalidate the other cache', async () => {
      const driver = memoryDriver();
      const a1 = atom<string>('shared', withDriver(driver), withMiddleware(cached()));
      const a2 = atom<string>('shared', withDriver(driver), withMiddleware(cached()));

      await a1.set('first');
      expect(await a2.get()).toBe('first'); // a2 reads from driver, warms cache

      await a1.set('second');

      // a1's set triggers eventBus -> a2's onExternalChange -> cache cleared
      const result = await a2.get();
      expect(result).toBe('second');

      a1.dispose();
      a2.dispose();
    });

    it('multiple set inside batch: eventBus notification deferred to batch end, cache may be inconsistent', async () => {
      const driver = memoryDriver();
      const a1 = atom<number>('val', withDriver(driver), withMiddleware(cached()));
      const a2 = atom<number>('val', withDriver(driver), withMiddleware(cached()));

      await a1.set(1);
      await a2.get(); // warm a2 cache with 1

      await batch(async () => {
        await a1.set(2);
        await a1.set(3);
        // eventBus notification is deferred within batch
        // a2's cache hasn't been cleared yet
        const duringBatch = await a2.get();
        // This exposes the cache inconsistency window during batch
        // Does a2 cache return old value 1, or read new value from driver?
        expect(duringBatch).toBeDefined();
      });

      // After batch ends, eventBus notification arrives, cache cleared
      const afterBatch = await a2.get();
      expect(afterBatch).toBe(3);

      a1.dispose();
      a2.dispose();
    });
  });

  describe('Middleware behavior after dispose', () => {
    it('pending debounce flush does not execute after dispose', async () => {
      vi.useFakeTimers();
      const driver = memoryDriver();
      const debounceMw = debounce(100);
      const a = atom<string>('key', withDriver(driver), withMiddleware(debounceMw));

      await a.set('pending');
      a.dispose();

      vi.advanceTimersByTime(200);

      // dispose clears pending, timer will not flush
      expect(await driver.get('key')).toBeUndefined();

      vi.useRealTimers();
    });

    it('onInit is called at construction, onDispose is called at dispose', async () => {
      const lifecycle: string[] = [];
      const mw: MiddlewareWithHooks = {
        handle: async (_ctx, next) => {
          await next();
        },
        onInit(context) {
          lifecycle.push(`init:${context.key}`);
        },
        onDispose() {
          lifecycle.push('dispose');
        },
      };

      const a = atom('mykey', withDriver(memoryDriver()), withMiddleware(mw));
      expect(lifecycle).toContain('init:mykey');

      a.dispose();
      expect(lifecycle).toContain('dispose');
      expect(lifecycle).toEqual(['init:mykey', 'dispose']);
    });

    it('scope clear triggers del which still executes through middleware', async () => {
      const operations: string[] = [];
      const tracker: MiddlewareFunction = async (ctx, next) => {
        operations.push(ctx.operation);
        await next();
      };

      const driver = memoryDriver();
      const scope = createScope('test');
      const a = atom<string>('key', withDriver(driver), withScope(scope), withMiddleware(tracker));

      await a.set('value');
      operations.length = 0;

      await scope.clear();

      // scope clear -> atom.del() -> middleware executes
      expect(operations).toContain('del');

      a.dispose();
    });
  });

  describe('Middleware error handling', () => {
    it('atom remains usable after middleware throws an exception', async () => {
      let shouldThrow = true;
      const flaky: MiddlewareFunction = async (ctx, next) => {
        if (shouldThrow && ctx.operation === 'set') {
          throw new Error('middleware error');
        }
        await next();
      };

      const a = atom<string>('key', withDriver(memoryDriver()), withMiddleware(flaky));

      await expect(a.set('fail')).rejects.toThrow('middleware error');

      shouldThrow = false;
      await a.set('success');
      expect(await a.get()).toBe('success');

      a.dispose();
    });

    it('reportError reports non-fatal error while operation continues', async () => {
      const warnings: MiddlewareFunction = async (ctx, next) => {
        await next();
        if (ctx.operation === 'get' && ctx.value === 'suspicious') {
          ctx.reportError(new Error('suspicious data detected'));
        }
      };

      const driver = memoryDriver();
      const a = atom<string>('key', withDriver(driver), withMiddleware(warnings));
      const errors: Error[] = [];
      a.addEventListener('error', (e) => {
        errors.push((e as CustomEvent).detail.error);
      });

      await a.set('suspicious');
      const value = await a.get();

      expect(value).toBe('suspicious'); // Operation succeeded
      expect(errors.length).toBe(1); // but there is a warning
      expect(errors[0].message).toBe('suspicious data detected');

      a.dispose();
    });

    it('behavior when all middleware do not call next', async () => {
      const dead1: MiddlewareFunction = async () => {
        /* noop */
      };
      const dead2: MiddlewareFunction = async () => {
        /* noop */
      };

      const driver = memoryDriver();
      const a = atom<string>('key', withDriver(driver), withMiddleware(dead1, dead2));

      // set doesn't reach driver
      await a.set('nothing');
      expect(await driver.get('key')).toBeUndefined();

      // Write directly to driver
      await driver.set('key', { $v: 'direct' });
      // get is also intercepted
      expect(await a.get()).toBeUndefined();

      a.dispose();
    });
  });

  describe('Full recommended middleware stack real-world scenario', () => {
    it('validate + ttl + versioned + cached full stack works', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(0);

      const driver = memoryDriver();
      const isObject = (v: unknown) => typeof v === 'object' && v !== null;
      const cacheMw = cached();

      const a = atom<{ name: string; v2?: boolean }>(
        'user-profile',
        withDriver(driver),
        withMiddleware(
          validate(isObject),
          ttl(5000),
          versioned({ current: 2, migrate: { 1: (d: any) => ({ ...d, v2: true }) } }),
          cacheMw,
        ),
      );

      // Normal write
      await a.set({ name: 'alice' });
      expect(await a.get()).toEqual({ name: 'alice' });

      // Verify cache works
      cacheMw.clear();
      expect(await a.get()).toEqual({ name: 'alice' });

      // Verify TTL expiry
      vi.advanceTimersByTime(6000);
      cacheMw.clear(); // Must clear cache to see TTL effect
      expect(await a.get()).toBeUndefined();

      // Verify validate rejects invalid values
      await expect(a.set('not-an-object' as any)).rejects.toThrow();

      vi.useRealTimers();
      a.dispose();
    });
  });
});
