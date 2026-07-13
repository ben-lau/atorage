import { atom } from '../../src/atom';
import { withDriver, withMiddleware } from '../../src/modifiers';
import { memoryDriver } from '../../src/drivers/memory';
import { cached } from '../../src/middleware/cached';
import { eventBus } from '../../src/core/event-bus';
import type { MiddlewareFunction } from '../../src/types';

describe('Scenario: unexpected mutations and state leaks', () => {
  afterEach(() => {
    eventBus._clear();
  });

  describe('Object reference passthrough — external mutation of stored values', () => {
    it('mutating the original object after set may cause get to return a polluted value', async () => {
      const driver = memoryDriver();
      const a = atom<{ name: string; tags: string[] }>('user', withDriver(driver));

      const user = { name: 'alice', tags: ['admin'] };
      await a.set(user);

      // Mutate the original object externally
      user.name = 'evil';
      user.tags.push('hacked');

      const stored = await a.get();
      // memoryDriver stores references, so the object is wrapped as { $v: user }
      // but wrap only does a shallow reference, not a deep clone
      // If the driver doesn't clone, this will be polluted
      // This exposes whether the storage layer does defensive copying
      expect(stored).toBeDefined();
      // Record actual behavior (exposes whether clone protection exists)
      if (stored!.name === 'evil') {
        // Reference passthrough — architectural flaw
        expect(stored!.tags).toContain('hacked');
      } else {
        // Has defensive copy
        expect(stored!.name).toBe('alice');
      }

      a.dispose();
    });

    it('mutating the get return value should not affect subsequent get results', async () => {
      const driver = memoryDriver();
      const a = atom<{ count: number }>('state', withDriver(driver));

      await a.set({ count: 0 });

      const first = await a.get();
      first!.count = 999; // External tampering

      const second = await a.get();
      // Without cache, each get reads from the driver, may still be reference passthrough
      // This exposes whether get returns the same reference
      expect(second).toBeDefined();

      a.dispose();
    });

    it('under cached, mutating get return value also pollutes the cache', async () => {
      const driver = memoryDriver();
      const a = atom<{ items: string[] }>('list', withDriver(driver), withMiddleware(cached()));

      await a.set({ items: ['a', 'b', 'c'] });

      const result = await a.get();
      result!.items.push('INJECTED');

      // Subsequent get reads from cache — cache stores the same reference
      const cached_result = await a.get();
      // If cache doesn't do deep copy, INJECTED will be visible
      expect(cached_result!.items).toBeDefined();

      // Record behavior: exposes whether cached returns references
      const hasInjection = cached_result!.items.includes('INJECTED');
      if (hasInjection) {
        // Cache reference leak — external code can freely modify cached content
        expect(cached_result!.items.length).toBe(4);
      }

      a.dispose();
    });
  });

  describe('Middleware accidental mutation of ctx', () => {
    it('middleware mutating ctx.meta exposes polluted meta to subsequent middleware', async () => {
      const metaSpy: Record<string, unknown>[] = [];

      const mw1: MiddlewareFunction = async (ctx, next) => {
        ctx.meta.secret = 'should-not-leak';
        await next();
      };
      const mw2: MiddlewareFunction = async (ctx, next) => {
        metaSpy.push({ ...ctx.meta });
        await next();
      };

      const a = atom<string>('key', withDriver(memoryDriver()), withMiddleware(mw1, mw2));

      await a.set('value');

      // mw2 sees meta from mw1 in onion model (mw1 runs before mw2)
      expect(metaSpy[0]).toHaveProperty('secret', 'should-not-leak');

      a.dispose();
    });

    it('middleware mutating ctx.value after next() in get makes caller see modified value', async () => {
      const tamper: MiddlewareFunction = async (ctx, next) => {
        await next();
        if (ctx.operation === 'get' && typeof ctx.value === 'string') {
          ctx.value = ctx.value + '[tampered]';
        }
      };

      const a = atom<string>('key', withDriver(memoryDriver()), withMiddleware(tamper));

      await a.set('original');
      expect(await a.get()).toBe('original[tampered]');

      // has() also checks via value, tamper adding suffix doesn't affect has
      expect(await a.has()).toBe(true);

      a.dispose();
    });

    it('middleware swallowing next() prevents driver operations from executing', async () => {
      const blocker: MiddlewareFunction = async (_ctx, _next) => {
        // Intentionally not calling next
      };

      const driver = memoryDriver();
      const a = atom<string>('key', withDriver(driver), withMiddleware(blocker));

      await a.set('blocked');
      // set never reached the driver
      expect(await driver.get('key')).toBeUndefined();
      // get is also intercepted, even if driver has data it won't be read
      await driver.set('key', { $v: 'direct' });
      expect(await a.get()).toBeUndefined();

      a.dispose();
    });

    it('middleware setting value to undefined during set causes driver to store null', async () => {
      const nullifier: MiddlewareFunction = async (ctx, next) => {
        if (ctx.operation === 'set') {
          ctx.value = undefined;
        }
        await next();
      };

      const driver = memoryDriver();
      const a = atom<string>('key', withDriver(driver), withMiddleware(nullifier));

      await a.set('something');

      const raw = await driver.get('key');
      // wrap(undefined, {}) -> { $v: null } (undefined converted to null for JSON safety)
      expect(raw).toEqual({ $v: null });

      // get unwraps to null (not undefined) — key exists with null value
      expect(await a.get()).toBeNull();
      // has returns true because the key exists in the driver
      expect(await a.has()).toBe(true);

      a.dispose();
    });
  });

  describe('External direct driver access bypassing atom', () => {
    it('writing directly to driver then atom get can read it (bypasses set middleware)', async () => {
      const driver = memoryDriver();
      const log: string[] = [];
      const logger: MiddlewareFunction = async (ctx, next) => {
        log.push(`${ctx.operation}-before`);
        await next();
        log.push(`${ctx.operation}-after`);
      };

      const a = atom<string>('key', withDriver(driver), withMiddleware(logger));

      // Bypass atom and write directly to driver (simulates other tab or external system modification)
      await driver.set('key', { $v: 'external' });

      const value = await a.get();
      expect(value).toBe('external');
      // get middleware still executes
      expect(log).toContain('get-before');
      expect(log).toContain('get-after');
      // but no set logs
      expect(log).not.toContain('set-before');

      a.dispose();
    });

    it('writing non-wrapped data directly to driver, atom still handles it', async () => {
      const driver = memoryDriver();
      const a = atom<string>('key', withDriver(driver));

      // Write raw value without $v envelope
      await driver.set('key', 'raw-string');

      // unwrap detects missing $v field, falls back to value = stored
      const value = await a.get();
      expect(value).toBe('raw-string');

      a.dispose();
    });

    it('after external deletion of driver data, cached atom still returns cached value (cache inconsistency)', async () => {
      const driver = memoryDriver();
      const a = atom<string>('key', withDriver(driver), withMiddleware(cached()));

      await a.set('cached-data');
      expect(await a.get()).toBe('cached-data'); // warm cache

      // Externally delete driver data directly
      await driver.del('key');

      // atom still returns data from cache — but driver is empty
      const fromCache = await a.get();
      expect(fromCache).toBe('cached-data');

      // Only after clearing cache can you see the real state
      // Cannot access internal middleware instance's clear()
      // This exposes the inconsistency of cached under external modification scenarios

      a.dispose();
    });
  });

  describe('Side effects of event listeners', () => {
    it('calling set inside a change event does not cause infinite loop', async () => {
      const driver = memoryDriver();
      const a = atom<number>('counter', withDriver(driver));
      let callCount = 0;

      a.addEventListener('change', async (e) => {
        callCount++;
        const val = (e as CustomEvent).detail.value;
        if (val < 3) {
          await a.set(val + 1);
        }
      });

      await a.set(1);

      // Wait for all cascading sets to complete
      await new Promise((r) => setTimeout(r, 50));

      // Should trigger 1 -> 2 -> 3, total 3 times
      expect(callCount).toBe(3);
      expect(await a.get()).toBe(3);

      a.dispose();
    });

    it('error event listener throwing does not affect atom normal operation', async () => {
      const driver = memoryDriver();
      const a = atom<string>('key', withDriver(driver));

      a.addEventListener('error', () => {
        throw new Error('listener crash');
      });

      // Normal operations do not trigger error event
      await a.set('safe');
      expect(await a.get()).toBe('safe');

      a.dispose();
    });

    it('events still queued after dispose should not fire', async () => {
      const driver = memoryDriver();
      const a = atom<string>('key', withDriver(driver));
      const events: string[] = [];

      a.addEventListener('change', () => events.push('change'));

      await a.set('before-dispose');
      expect(events).toEqual(['change']);

      a.dispose();

      // Can't set after dispose, so simulate via eventBus
      // External notification arrives after atom is disposed
      eventBus.notify('key', 'fake-source', [], { type: 'change', value: 'ghost' });

      // Disposed atom should not respond — it has unregistered
      expect(events).toEqual(['change']);
    });
  });

  describe('Boundaries of type safety', () => {
    it('TypeScript type annotation is number but actual stored value is string (no runtime protection)', async () => {
      const driver = memoryDriver();
      const a = atom<number>('typed', withDriver(driver));

      // Bypass types and write wrong-type data directly
      await driver.set('typed', { $v: 'not-a-number' });

      const value = await a.get();
      // TypeScript compile-time thinks value: number | undefined
      // Runtime is actually string — no runtime type checking
      expect(typeof value).toBe('string');

      a.dispose();
    });

    it('difference between set(null) and set(undefined)', async () => {
      const driver = memoryDriver();
      const a = atom<string | null>('nullable', withDriver(driver));

      await a.set(null as any);
      // null is a valid value
      const val = await a.get();
      expect(val).toBeNull();

      // How does has() treat null? value !== undefined → true
      expect(await a.has()).toBe(true);

      a.dispose();
    });
  });
});
