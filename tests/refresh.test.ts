import { atom } from '../src/atom';
import { withDriver, withMiddleware } from '../src/modifiers';
import { memoryDriver } from '../src/drivers/memory';
import { cached } from '../src/middleware/cached';

function spyDriver() {
  const driver = memoryDriver();
  let getCount = 0;
  return {
    ...driver,
    get: async (key: string) => {
      getCount++;
      return driver.get(key);
    },
    getCount: () => getCount,
  };
}

describe('cached.clear() (fresh read)', () => {
  it('clear() then get() bypasses cache and reads from driver', async () => {
    const driver = spyDriver();
    const myCache = cached();
    const a = atom<string>('cache-clear-key', withDriver(driver), withMiddleware(myCache));

    await a.set('initial');
    await expect(a.get()).resolves.toBe('initial');
    expect(driver.getCount()).toBe(0);

    await driver.set(a.key, { $v: 'from-driver' });

    await expect(a.get()).resolves.toBe('initial');
    expect(driver.getCount()).toBe(0);

    myCache.clear();
    await expect(a.get()).resolves.toBe('from-driver');
    expect(driver.getCount()).toBe(1);

    a.dispose();
  });

  it('clear() without cached middleware has no effect', async () => {
    const driver = spyDriver();
    const a = atom<string>('no-cache-key', withDriver(driver));

    await a.set('value');
    expect(driver.getCount()).toBe(0);

    await expect(a.get()).resolves.toBe('value');
    expect(driver.getCount()).toBe(1);

    await expect(a.get()).resolves.toBe('value');
    expect(driver.getCount()).toBe(2);

    a.dispose();
  });

  it('get after clear() updates the cache for next read', async () => {
    const driver = spyDriver();
    const myCache = cached();
    const a = atom<string>('cache-update-key', withDriver(driver), withMiddleware(myCache));

    await a.set('v1');
    await driver.set(a.key, { $v: 'v2' });

    myCache.clear();
    await expect(a.get()).resolves.toBe('v2');
    const countAfterClear = driver.getCount();

    await expect(a.get()).resolves.toBe('v2');
    expect(driver.getCount()).toBe(countAfterClear);

    a.dispose();
  });
});
