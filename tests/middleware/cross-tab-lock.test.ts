// @vitest-environment happy-dom
import { crossTabLock } from '../../src/middleware/cross-tab-lock';
import { atom } from '../../src/atom';
import { withDriver, withMiddleware } from '../../src/modifiers';
import { memoryDriver } from '../../src/drivers/memory';

let lockCalls: string[] = [];

beforeEach(() => {
  lockCalls = [];
  Object.defineProperty(navigator, 'locks', {
    value: {
      request: async (name: string, opts: any, callback?: () => Promise<void>) => {
        lockCalls.push(name);
        const fn = typeof opts === 'function' ? opts : callback!;
        await fn();
      },
    },
    configurable: true,
  });
});

describe('crossTabLock middleware', () => {
  it('only set/del acquire a lock, get/has do not', async () => {
    const driver = memoryDriver();
    const a = atom<string>('my-key', withDriver(driver), withMiddleware(crossTabLock()));

    await a.set('value');
    expect(lockCalls).toEqual(['atorage:my-key']);

    await a.get();
    expect(lockCalls).toEqual(['atorage:my-key']);

    await a.del();
    expect(lockCalls).toEqual(['atorage:my-key', 'atorage:my-key']);

    a.dispose();
  });

  it('multiple operations on same key go through the lock', async () => {
    const driver = memoryDriver();
    const a = atom<number>('shared-key', withDriver(driver), withMiddleware(crossTabLock()));

    await Promise.all([a.set(1), a.set(2), a.set(3)]);

    expect(lockCalls).toEqual(['atorage:shared-key', 'atorage:shared-key', 'atorage:shared-key']);
    await expect(a.get()).resolves.toBe(3);

    a.dispose();
  });

  it('falls back to no-lock when navigator.locks is undefined', async () => {
    Object.defineProperty(navigator, 'locks', {
      value: undefined,
      configurable: true,
    });

    const driver = memoryDriver();
    const a = atom<string>('fallback-key', withDriver(driver), withMiddleware(crossTabLock()));

    await a.set('works');
    expect(lockCalls).toEqual([]);
    await expect(a.get()).resolves.toBe('works');

    a.dispose();
  });
});
