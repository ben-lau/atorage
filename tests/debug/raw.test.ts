import { raw } from '../../src/debug/raw';
import { memoryDriver } from '../../src/drivers/memory';
import { wrap } from '../../src/core/wrap';
import { atom } from '../../src/atom';
import { withDriver } from '../../src/modifiers';

describe('raw', () => {
  it('set writes value directly (not wrapped with $v/$m)', async () => {
    const driver = memoryDriver();
    const key = 'plain-key';

    await raw.set(driver, key, { hello: 'world' });

    const stored = await driver.get(key);
    expect(stored).toEqual({ hello: 'world' });
    expect(stored).not.toHaveProperty('$v');
  });

  it('get reads raw stored data exactly as stored in driver', async () => {
    const driver = memoryDriver();
    const key = 'raw-key';
    const wrapped = wrap('secret', { exp: 123 });

    await driver.set(key, wrapped);

    await expect(raw.get(driver, key)).resolves.toEqual({
      $v: 'secret',
      $m: { exp: 123 },
    });
  });

  it('del removes the data from driver', async () => {
    const driver = memoryDriver();
    const key = 'delete-me';

    await raw.set(driver, key, 'value');
    await raw.del(driver, key);

    await expect(driver.has(key)).resolves.toBe(false);
    await expect(raw.get(driver, key)).resolves.toBeUndefined();
  });

  it('bypass: atom write wraps, raw read sees { $v, $m } structure', async () => {
    const driver = memoryDriver();
    const a = atom('token', withDriver(driver));

    await a.set('my-token');

    const stored = await raw.get(driver, a.key);
    expect(stored).toEqual({ $v: 'my-token' });

    a.dispose();
  });

  it('bypass: raw write without wrap, atom read treats value as unwrapped data', async () => {
    const driver = memoryDriver();
    const a = atom('legacy', withDriver(driver));

    await raw.set(driver, a.key, 'legacy-value');

    await expect(a.get()).resolves.toBe('legacy-value');
    await expect(a.has()).resolves.toBe(true);

    a.dispose();
  });
});
