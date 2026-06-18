import { memoryDriver } from '../../src/drivers/memory';

describe('memoryDriver', () => {
  it('set then get returns the value', async () => {
    const driver = memoryDriver();
    await driver.set('foo', 'bar');
    expect(await driver.get('foo')).toBe('bar');
  });

  it('get non-existent key returns undefined', async () => {
    const driver = memoryDriver();
    expect(await driver.get('missing')).toBeUndefined();
  });

  it('has returns true/false correctly', async () => {
    const driver = memoryDriver();
    expect(await driver.has('foo')).toBe(false);
    await driver.set('foo', 1);
    expect(await driver.has('foo')).toBe(true);
  });

  it('del removes the value', async () => {
    const driver = memoryDriver();
    await driver.set('foo', 'bar');
    await driver.del('foo');
    expect(await driver.get('foo')).toBeUndefined();
    expect(await driver.has('foo')).toBe(false);
  });

  it('keys returns all keys', async () => {
    const driver = memoryDriver();
    await driver.set('a', 1);
    await driver.set('b', 2);
    await driver.set('c', 3);
    expect(await driver.keys()).toEqual(expect.arrayContaining(['a', 'b', 'c']));
    expect((await driver.keys()).length).toBe(3);
  });

  it('keys with prefix filters correctly', async () => {
    const driver = memoryDriver();
    await driver.set('user:1', 'alice');
    await driver.set('user:2', 'bob');
    await driver.set('post:1', 'hello');
    expect(await driver.keys('user:')).toEqual(expect.arrayContaining(['user:1', 'user:2']));
    expect((await driver.keys('user:')).length).toBe(2);
  });

  it('batch applies multiple operations', async () => {
    const driver = memoryDriver();
    await driver.batch!([
      { type: 'set', key: 'a', value: 1 },
      { type: 'set', key: 'b', value: 2 },
      { type: 'del', key: 'a' },
    ]);
    expect(await driver.get('a')).toBeUndefined();
    expect(await driver.get('b')).toBe(2);
  });

  it('dispose clears all data', async () => {
    const driver = memoryDriver();
    await driver.set('foo', 'bar');
    await driver.dispose();
    expect(await driver.get('foo')).toBeUndefined();
    expect(await driver.keys()).toEqual([]);
  });

  it('works with complex objects', async () => {
    const driver = memoryDriver();
    const value = {
      nested: { arr: [1, 2, 3], date: new Date('2024-01-01') },
      fn: () => 'hello',
    };
    await driver.set('complex', value);
    expect(await driver.get('complex')).toBe(value);
  });
});
