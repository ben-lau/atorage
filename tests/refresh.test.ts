import { atom } from '../src/atom';
import { withDriver } from '../src/modifiers';
import { memoryDriver } from '../src/drivers/memory';

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

describe('get freshness (no transparent cache)', () => {
  it('repeated get always reads from driver; peek stays in sync', async () => {
    const driver = spyDriver();
    const a = atom<string>('fresh-key', withDriver(driver));

    await a.set('initial');
    expect(a.peek()).toBe('initial');
    expect(driver.getCount()).toBe(0);

    await expect(a.get()).resolves.toBe('initial');
    expect(driver.getCount()).toBe(1);
    expect(a.peek()).toBe('initial');

    await driver.set(a.key, { $v: 'from-driver' });
    await expect(a.get()).resolves.toBe('from-driver');
    expect(driver.getCount()).toBe(2);
    expect(a.peek()).toBe('from-driver');

    a.dispose();
  });

  it('peek stays stale after external write until get', async () => {
    const driver = spyDriver();
    const a = atom<string>('stale-peek-key', withDriver(driver));

    await a.set('v1');
    expect(a.peek()).toBe('v1');

    await driver.set(a.key, { $v: 'v2' });
    expect(a.peek()).toBe('v1');

    await expect(a.get()).resolves.toBe('v2');
    expect(a.peek()).toBe('v2');

    a.dispose();
  });
});
