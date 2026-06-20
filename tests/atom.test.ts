import { atom } from '../src/atom';
import { withDriver, withScope, withMiddleware, withPreMiddleware } from '../src/modifiers';
import { createScope } from '../src/scope';
import { memoryDriver } from '../src/drivers/memory';
import { AtomDisposedError } from '../src/errors';
import { eventBus } from '../src/core/event-bus';
import type { MiddlewareFunction, MiddlewareWithHooks, Driver } from '../src/types';

function failingSetDriver(): Driver {
  return {
    name: 'failing-set',
    get: () => Promise.resolve(undefined),
    set: () => Promise.reject(new Error('fail')),
    del: () => Promise.resolve(),
    has: () => Promise.resolve(false),
    keys: () => Promise.resolve([]),
    dispose: () => Promise.resolve(),
  };
}

describe('atom', () => {
  afterEach(() => {
    eventBus._clear();
  });

  describe('basic CRUD', () => {
    it('set then get returns value', async () => {
      const driver = memoryDriver();
      const a = atom('foo', withDriver(driver));

      await a.set('hello');
      await expect(a.get()).resolves.toBe('hello');

      a.dispose();
    });

    it('get with no value returns undefined', async () => {
      const a = atom('empty', withDriver(memoryDriver()));

      await expect(a.get()).resolves.toBeUndefined();

      a.dispose();
    });

    it('get returns undefined when empty, user applies ?? for default', async () => {
      const a = atom('empty', withDriver(memoryDriver()));

      const val = (await a.get()) ?? 'fallback';
      expect(val).toBe('fallback');

      a.dispose();
    });

    it('del removes value, has returns false', async () => {
      const a = atom('foo', withDriver(memoryDriver()));

      await a.set('hello');
      await a.del();
      await expect(a.has()).resolves.toBe(false);

      a.dispose();
    });

    it('del resolves without returning a value', async () => {
      const a = atom('foo', withDriver(memoryDriver()));

      await a.set('hello');
      await expect(a.del()).resolves.toBeUndefined();

      a.dispose();
    });

    it('has returns true/false correctly', async () => {
      const a = atom('foo', withDriver(memoryDriver()));

      await expect(a.has()).resolves.toBe(false);
      await a.set('hello');
      await expect(a.has()).resolves.toBe(true);

      a.dispose();
    });
  });

  describe('update()', () => {
    it('update reads previous value and writes new value', async () => {
      const a = atom<number>('counter', withDriver(memoryDriver()));

      await a.set(1);
      await a.update((prev) => (prev ?? 0) + 1);
      await expect(a.get()).resolves.toBe(2);

      a.dispose();
    });

    it('update with undefined previous (no existing value)', async () => {
      const a = atom<number>('counter', withDriver(memoryDriver()));

      await a.update((prev) => (prev ?? 0) + 5);
      await expect(a.get()).resolves.toBe(5);

      a.dispose();
    });

    it('concurrent updates execute serially', async () => {
      const order: number[] = [];
      const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
      const a = atom<number>('counter', withDriver(memoryDriver()));

      await a.set(0);

      const first = a.update(async (prev) => {
        order.push(1);
        await delay(30);
        return (prev ?? 0) + 1;
      });
      const second = a.update(async (prev) => {
        order.push(2);
        await delay(10);
        return (prev ?? 0) + 10;
      });

      await Promise.all([first, second]);

      expect(order).toEqual([1, 2]);
      await expect(a.get()).resolves.toBe(11);

      a.dispose();
    });

    it('update returns the new value', async () => {
      const a = atom<number>('counter', withDriver(memoryDriver()));

      await expect(a.update((prev) => (prev ?? 0) + 3)).resolves.toBe(3);

      a.dispose();
    });
  });

  describe('middleware', () => {
    it('middleware intercepts set (modifies value before driver)', async () => {
      const doubler: MiddlewareFunction = async (ctx, next) => {
        if (ctx.operation === 'set' && typeof ctx.value === 'number') {
          ctx.value = ctx.value * 2;
        }
        await next();
      };
      const a = atom<number>('num', withDriver(memoryDriver()), withMiddleware(doubler));

      await a.set(5);
      await expect(a.get()).resolves.toBe(10);

      a.dispose();
    });

    it('middleware intercepts get (modifies value after driver read)', async () => {
      const suffixer: MiddlewareFunction = async (ctx, next) => {
        await next();
        if (ctx.operation === 'get' && typeof ctx.value === 'string') {
          ctx.value = ctx.value + '!';
        }
      };
      const a = atom<string>('msg', withDriver(memoryDriver()), withMiddleware(suffixer));

      await a.set('hello');
      await expect(a.get()).resolves.toBe('hello!');

      a.dispose();
    });

    it('middleware onion order (multiple middleware execute in correct order)', async () => {
      const order: string[] = [];
      const mw1: MiddlewareFunction = async (_ctx, next) => {
        order.push('mw1-before');
        await next();
        order.push('mw1-after');
      };
      const mw2: MiddlewareFunction = async (_ctx, next) => {
        order.push('mw2-before');
        await next();
        order.push('mw2-after');
      };
      const a = atom('key', withDriver(memoryDriver()), withMiddleware(mw1, mw2));

      await a.set('value');

      expect(order).toEqual(['mw1-before', 'mw2-before', 'mw2-after', 'mw1-after']);

      a.dispose();
    });

    it('middleware has() interception', async () => {
      const hideAll: MiddlewareFunction = async (ctx, next) => {
        await next();
        if (ctx.operation === 'has') {
          ctx.value = undefined;
        }
      };
      const a = atom('key', withDriver(memoryDriver()), withMiddleware(hideAll));

      await a.set('exists');
      await expect(a.has()).resolves.toBe(false);

      a.dispose();
    });

    it('MiddlewareWithHooks: onExternalChange is called on event bus notification', async () => {
      const onExternalChange = vi.fn();
      const mw: MiddlewareWithHooks = {
        handle: async (_ctx, next) => {
          await next();
        },
        onExternalChange,
      };
      const driver = memoryDriver();
      const source = atom('shared', withDriver(driver), withMiddleware(mw));
      const listener = atom('shared', withDriver(driver), withMiddleware(mw));

      await source.set('updated');

      expect(onExternalChange).toHaveBeenCalledOnce();

      source.dispose();
      listener.dispose();
    });

    it('MiddlewareWithHooks: onDispose is called on atom.dispose()', async () => {
      const onDispose = vi.fn();
      const mw: MiddlewareWithHooks = {
        handle: async (_ctx, next) => {
          await next();
        },
        onDispose,
      };
      const a = atom('key', withDriver(memoryDriver()), withMiddleware(mw));

      a.dispose();
      expect(onDispose).toHaveBeenCalledOnce();
    });
  });

  describe('requestWriteback', () => {
    it('middleware calls requestWriteback during get → triggers automatic set', async () => {
      const writebackMw: MiddlewareFunction = async (ctx, next) => {
        await next();
        if (ctx.operation === 'get') {
          ctx.value = 'computed';
          ctx.requestWriteback();
        }
      };
      const driver = memoryDriver();
      const a = atom<string>('key', withDriver(driver), withMiddleware(writebackMw));

      await expect(a.get()).resolves.toBe('computed');
      await expect(a.get()).resolves.toBe('computed');

      const stored = await driver.get('key');
      expect(stored).toEqual({ $v: 'computed' });

      a.dispose();
    });
  });

  describe('events', () => {
    it("set dispatches 'change' event with value in detail", async () => {
      const a = atom<string>('key', withDriver(memoryDriver()));
      const listener = vi.fn();

      a.addEventListener('change', listener);
      await a.set('new-value');

      expect(listener).toHaveBeenCalledOnce();
      expect(listener.mock.calls[0][0].type).toBe('change');

      a.dispose();
    });

    it("del dispatches 'delete' event", async () => {
      const a = atom('key', withDriver(memoryDriver()));
      const listener = vi.fn();

      await a.set('value');
      a.addEventListener('delete', listener);
      await a.del();

      expect(listener).toHaveBeenCalledOnce();
      expect(listener.mock.calls[0][0].type).toBe('delete');

      a.dispose();
    });

    it('change event detail contains the new value', async () => {
      const a = atom<number>('key', withDriver(memoryDriver()));
      let detail: { value: number | undefined } | undefined;

      a.addEventListener('change', (event) => {
        detail = (event as CustomEvent).detail;
      });
      await a.set(42);

      expect(detail).toEqual({ value: 42 });

      a.dispose();
    });
  });

  describe('event bus (same-key multi-instance)', () => {
    it('two atoms with same key+driver: setting one triggers change on the other', async () => {
      const driver = memoryDriver();
      const a1 = atom<string>('shared', withDriver(driver));
      const a2 = atom<string>('shared', withDriver(driver));
      const changes2: unknown[] = [];

      a2.addEventListener('change', (event) => {
        changes2.push((event as CustomEvent).detail.value);
      });

      await a1.set('synced');

      expect(changes2).toEqual(['synced']);

      a1.dispose();
      a2.dispose();
    });

    it('the source atom does NOT get an extra change from the bus (only its own)', async () => {
      const driver = memoryDriver();
      const a1 = atom<string>('shared', withDriver(driver));
      const a2 = atom<string>('shared', withDriver(driver));
      const changes1: unknown[] = [];

      a1.addEventListener('change', (event) => {
        changes1.push((event as CustomEvent).detail.value);
      });

      await a1.set('once');

      expect(changes1).toEqual(['once']);

      a1.dispose();
      a2.dispose();
    });
  });

  describe('scope', () => {
    it('withScope prefixes the key (scope name + ":" + key)', async () => {
      const scope = createScope('app');
      const a = atom('user', withDriver(memoryDriver()), withScope(scope));

      expect(a.key).toBe('app:user');

      a.dispose();
    });

    it('multiple scopes: key is "scope1:scope2:key"', async () => {
      const scope1 = createScope('scope1');
      const scope2 = createScope('scope2');
      const a = atom('key', withDriver(memoryDriver()), withScope(scope1, scope2));

      expect(a.key).toBe('scope1:scope2:key');

      a.dispose();
    });

    it('scope.clear() triggers atom.del() (value removed from driver)', async () => {
      const driver = memoryDriver();
      const scope = createScope('app');
      const a = atom('user', withDriver(driver), withScope(scope));

      await a.set('data');
      await expect(a.has()).resolves.toBe(true);

      await scope.clear();

      await expect(a.has()).resolves.toBe(false);
      await expect(driver.get('app:user')).resolves.toBeUndefined();

      a.dispose();
    });

    it('after dispose, scope.clear() does NOT trigger del', async () => {
      const driver = memoryDriver();
      const scope = createScope('app');
      const a = atom('user', withDriver(driver), withScope(scope));

      await a.set('data');
      a.dispose();

      await scope.clear();

      const stored = await driver.get('app:user');
      expect(stored).toEqual({ $v: 'data' });
    });
  });

  describe('driver degradation', () => {
    it('withDriver([driver1, driver2]): writes to first, reads from first', async () => {
      const driver1 = memoryDriver();
      const driver2 = memoryDriver();
      const a = atom('key', withDriver([driver1, driver2]));

      await a.set('primary');
      await expect(a.get()).resolves.toBe('primary');
      expect(await driver1.get('key')).toEqual({ $v: 'primary' });
      expect(await driver2.get('key')).toBeUndefined();

      a.dispose();
    });

    it('when first driver fails on set, falls back to second', async () => {
      const driver1 = failingSetDriver();
      const driver2 = memoryDriver();
      const a = atom('key', withDriver([driver1, driver2]));

      await a.set('fallback');
      await expect(a.get()).resolves.toBe('fallback');
      expect(await driver2.get('key')).toEqual({ $v: 'fallback' });

      a.dispose();
    });
  });

  describe('dispose()', () => {
    it('after dispose, get/set/del/has/update all throw AtomDisposedError', async () => {
      const a = atom<number>('key', withDriver(memoryDriver()));

      await a.set(1);
      a.dispose();

      await expect(a.get()).rejects.toThrow(AtomDisposedError);
      await expect(a.set(2)).rejects.toThrow(AtomDisposedError);
      await expect(a.del()).rejects.toThrow(AtomDisposedError);
      await expect(a.has()).rejects.toThrow(AtomDisposedError);
      await expect(a.update((v) => (v ?? 0) + 1)).rejects.toThrow(AtomDisposedError);
    });

    it('dispose is idempotent (calling twice does not throw)', () => {
      const a = atom('key', withDriver(memoryDriver()));

      expect(() => {
        a.dispose();
        a.dispose();
      }).not.toThrow();
    });
  });

  describe('getMeta()', () => {
    it('getMeta returns undefined when no value stored', async () => {
      const a = atom('key', withDriver(memoryDriver()));

      await expect(a.getMeta()).resolves.toBeUndefined();

      a.dispose();
    });

    it('getMeta returns meta when middleware wrote meta', async () => {
      const withMeta: MiddlewareFunction = async (ctx, next) => {
        if (ctx.operation === 'set') {
          ctx.meta = { ...ctx.meta, source: 'middleware' };
        }
        await next();
      };
      const a = atom('key', withDriver(memoryDriver()), withMiddleware(withMeta));

      await a.set('value');
      await expect(a.getMeta()).resolves.toEqual({ source: 'middleware' });

      a.dispose();
    });
  });
});
