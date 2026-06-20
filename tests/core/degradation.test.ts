import { degradedGet, degradedSet, degradedDel } from '../../src/core/degradation';
import { memoryDriver } from '../../src/drivers/memory';
import { StorageError } from '../../src/errors';
import type { Driver } from '../../src/types';

function failingDriver(name: string): Driver {
  return {
    name,
    get: () => Promise.reject(new Error(`${name} fail`)),
    set: () => Promise.reject(new Error(`${name} fail`)),
    del: () => Promise.reject(new Error(`${name} fail`)),
    has: () => Promise.reject(new Error(`${name} fail`)),
    keys: () => Promise.reject(new Error(`${name} fail`)),
    dispose: () => Promise.resolve(),
  };
}

describe('degradedGet', () => {
  it('returns value from first driver that has it', async () => {
    const driver1 = memoryDriver();
    const driver2 = memoryDriver();
    await driver1.set('key', 'from-first');
    await driver2.set('key', 'from-second');

    const result = await degradedGet([driver1, driver2], 'key');

    expect(result).toBe('from-first');
  });

  it('returns undefined when no driver has the key', async () => {
    const driver1 = memoryDriver();
    const driver2 = memoryDriver();

    const result = await degradedGet([driver1, driver2], 'missing');

    expect(result).toBeUndefined();
  });

  it('skips to second driver when first returns undefined', async () => {
    const driver1 = memoryDriver();
    const driver2 = memoryDriver();
    await driver2.set('key', 'from-second');

    const result = await degradedGet([driver1, driver2], 'key');

    expect(result).toBe('from-second');
  });

  it('primary throws, fallback returns undefined → returns undefined (partial error is silent)', async () => {
    const primary = failingDriver('primary');
    const fallback = memoryDriver();

    const result = await degradedGet([primary, fallback], 'missing');

    expect(result).toBeUndefined();
  });

  it('primary returns undefined, fallback throws → returns undefined (healthy driver answered)', async () => {
    const primary = memoryDriver();
    const fallback = failingDriver('fallback');

    const result = await degradedGet([primary, fallback], 'missing');

    expect(result).toBeUndefined();
  });

  it('3 drivers: middle returns undefined, outer two throw → returns undefined', async () => {
    const d1 = failingDriver('d1');
    const d2 = memoryDriver();
    const d3 = failingDriver('d3');

    const result = await degradedGet([d1, d2, d3], 'missing');

    expect(result).toBeUndefined();
  });

  it('primary throws, fallback has value → returns fallback value (degradation works)', async () => {
    const primary = failingDriver('primary');
    const fallback = memoryDriver();
    await fallback.set('key', 'fallback-data');

    const result = await degradedGet([primary, fallback], 'key');

    expect(result).toBe('fallback-data');
  });

  it('all drivers throw → throws StorageError with all errors', async () => {
    const d1 = failingDriver('d1');
    const d2 = failingDriver('d2');
    const d3 = failingDriver('d3');

    await expect(degradedGet([d1, d2, d3], 'key')).rejects.toThrow(StorageError);
  });
});

describe('degradedSet', () => {
  it('writes to first driver, deletes from others (stale cleanup)', async () => {
    const driver1 = memoryDriver();
    const driver2 = memoryDriver();
    await driver2.set('key', 'stale');

    await degradedSet([driver1, driver2], 'key', 'fresh');

    expect(await driver1.get('key')).toBe('fresh');
    expect(await driver2.get('key')).toBeUndefined();
  });

  it('falls back to second driver when first fails', async () => {
    const driver1 = failingDriver('fail1');
    const driver2 = memoryDriver();

    await degradedSet([driver1, driver2], 'key', 'value');

    expect(await driver2.get('key')).toBe('value');
  });

  it('throws StorageError when all drivers fail', async () => {
    const driver1 = failingDriver('fail1');
    const driver2 = failingDriver('fail2');

    await expect(degradedSet([driver1, driver2], 'key', 'value')).rejects.toThrow(StorageError);

    await expect(degradedSet([driver1, driver2], 'key', 'value')).rejects.toThrow(
      'All drivers failed on set',
    );
  });
});

describe('degradedDel', () => {
  it('deletes from all drivers', async () => {
    const driver1 = memoryDriver();
    const driver2 = memoryDriver();
    await driver1.set('key', 'a');
    await driver2.set('key', 'b');

    await degradedDel([driver1, driver2], 'key');

    expect(await driver1.get('key')).toBeUndefined();
    expect(await driver2.get('key')).toBeUndefined();
  });

  it("doesn't throw even if a driver fails", async () => {
    const driver1 = failingDriver('fail1');
    const driver2 = memoryDriver();
    await driver2.set('key', 'value');

    await expect(degradedDel([driver1, driver2], 'key')).resolves.toBeUndefined();
    expect(await driver2.get('key')).toBeUndefined();
  });
});

describe('degradedGet null handling', () => {
  it('treats null as a valid value', async () => {
    const driver = memoryDriver();
    await driver.set('key', null);

    const result = await degradedGet([driver], 'key');
    expect(result).toBeNull();
  });
});
