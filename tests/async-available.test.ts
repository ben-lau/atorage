import { atom } from '../src/atom';
import { withDriver } from '../src/modifiers';
import { memoryDriver } from '../src/drivers/memory';
import type { Driver } from '../src/types';

function wrapDriver(
  inner: Driver,
  available: () => Promise<boolean> | boolean,
  name = 'wrapped',
): Driver {
  return {
    ...inner,
    name,
    available,
  };
}

function trackingDriver(name: string): Driver & { sets: string[] } {
  const store = new Map<string, unknown>();
  const sets: string[] = [];
  return {
    name,
    sets,
    available: () => Promise.resolve(true),
    get: (key) => Promise.resolve(store.get(key)),
    set: async (key, value) => {
      sets.push(key);
      store.set(key, value);
    },
    del: async (key) => {
      store.delete(key);
    },
    has: (key) => Promise.resolve(store.has(key)),
    keys: (prefix) => {
      const all = [...store.keys()];
      return Promise.resolve(prefix ? all.filter((k) => k.startsWith(prefix)) : all);
    },
    dispose: async () => {
      store.clear();
    },
  };
}

describe('async available()', () => {
  it('filters driver when available() resolves to false', async () => {
    const unavailableInner = trackingDriver('unavailable');
    const unavailable = wrapDriver(unavailableInner, () => Promise.resolve(false), 'unavailable');
    const fallback = memoryDriver();

    const a = atom<string>('async-unavail-key', withDriver([unavailable, fallback]));

    await a.set('via-fallback');
    await expect(a.get()).resolves.toBe('via-fallback');
    expect(unavailableInner.sets).toEqual([]);

    a.dispose();
  });

  it('keeps driver when available() resolves to true', async () => {
    const primary = trackingDriver('primary');
    const fallback = memoryDriver();

    const a = atom<string>('async-avail-key', withDriver([primary, fallback]));

    await a.set('via-primary');
    await expect(a.get()).resolves.toBe('via-primary');
    expect(primary.sets).toEqual([a.key]);

    a.dispose();
  });

  it('available() throws → driver is excluded, fallback used', async () => {
    const throwingInner = trackingDriver('throwing');
    const throwing = wrapDriver(
      throwingInner,
      () => {
        throw new Error('check failed');
      },
      'throwing',
    );
    const fallback = memoryDriver();

    const a = atom<string>('avail-throw-key', withDriver([throwing, fallback]));

    await a.set('fallback-val');
    await expect(a.get()).resolves.toBe('fallback-val');
    expect(throwingInner.sets).toEqual([]);

    a.dispose();
  });

  it('available() rejects → driver is excluded, fallback used', async () => {
    const rejectInner = trackingDriver('rejecting');
    const rejecting = wrapDriver(
      rejectInner,
      () => Promise.reject(new Error('async check failed')),
      'rejecting',
    );
    const fallback = memoryDriver();

    const a = atom<string>('avail-reject-key', withDriver([rejecting, fallback]));

    await a.set('fallback-val');
    await expect(a.get()).resolves.toBe('fallback-val');
    expect(rejectInner.sets).toEqual([]);

    a.dispose();
  });

  it('all drivers unavailable → all operations throw', async () => {
    const d1 = wrapDriver(trackingDriver('d1'), () => false, 'd1');
    const d2 = wrapDriver(trackingDriver('d2'), () => Promise.resolve(false), 'd2');

    const a = atom<string>('all-unavail', withDriver([d1, d2]));

    await expect(a.set('lost')).rejects.toThrow(/no available drivers/);
    await expect(a.get()).rejects.toThrow(/no available drivers/);

    a.dispose();
  });
});
