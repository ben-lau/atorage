import { inspect } from '../../src/debug/inspect';
import { raw } from '../../src/debug/raw';
import { memoryDriver } from '../../src/drivers/memory';
import { atom } from '../../src/atom';
import { withDriver, withMiddleware } from '../../src/modifiers';
import { ttl } from '../../src/middleware/ttl';

describe('inspect', () => {
  it('returns exists=false for non-existent key', async () => {
    const driver = memoryDriver();

    const result = await inspect(driver, 'missing');

    expect(result).toEqual({
      exists: false,
      raw: undefined,
      value: undefined,
      meta: {},
    });

    await driver.dispose();
  });

  it('returns wrapped value for atom write without middleware', async () => {
    const driver = memoryDriver();
    const a = atom('plain', withDriver(driver));

    await a.set('hello');

    const result = await inspect(driver, a.key);

    expect(result.exists).toBe(true);
    expect(result.raw).toEqual({ $v: 'hello' });
    expect(result.value).toBe('hello');
    expect(result.meta).toEqual({});

    a.dispose();
    await driver.dispose();
  });

  it('returns wrapped value with meta for atom write with ttl', async () => {
    vi.useFakeTimers();
    const now = Date.now();
    vi.setSystemTime(now);

    const driver = memoryDriver();
    const a = atom('ttl-key', withDriver(driver), withMiddleware(ttl(1000)));

    await a.set('hello');

    const result = await inspect(driver, a.key);

    expect(result.exists).toBe(true);
    expect(result.raw).toEqual({ $v: 'hello', $m: { exp: now + 1000 } });
    expect(result.value).toBe('hello');
    expect(typeof result.meta.exp).toBe('number');
    expect(result.meta.exp).toBe(now + 1000);

    a.dispose();
    await driver.dispose();
    vi.useRealTimers();
  });

  it('returns unwrapped value for raw.set write', async () => {
    const driver = memoryDriver();
    const key = 'plain';

    await raw.set(driver, key, { hello: 'world' });

    const result = await inspect(driver, key);

    expect(result.exists).toBe(true);
    expect(result.raw).toEqual({ hello: 'world' });
    expect(result.value).toEqual({ hello: 'world' });
    expect(result.meta).toEqual({});

    await driver.dispose();
  });
});
