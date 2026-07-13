// @vitest-environment happy-dom
import { localStorageDriver } from '../../src/drivers/local-storage';
import { atom } from '../../src/atom';
import { withDriver } from '../../src/modifiers';

describe('localStorageDriver', () => {
  beforeEach(() => window.localStorage.clear());

  it('available() returns true in happy-dom', () => {
    const driver = localStorageDriver();
    expect(driver.available!()).toBe(true);
  });

  it('set then get returns the value (objects are JSON serialized/deserialized)', async () => {
    const driver = localStorageDriver();
    await driver.set('foo', 'bar');
    expect(await driver.get('foo')).toBe('bar');
    await driver.set('num', 42);
    expect(await driver.get('num')).toBe(42);
  });

  it('get non-existent key returns undefined (NOT null)', async () => {
    const driver = localStorageDriver();
    expect(await driver.get('missing')).toBeUndefined();
    expect(await driver.get('missing')).not.toBeNull();
  });

  it('has returns true/false correctly', async () => {
    const driver = localStorageDriver();
    expect(await driver.has('foo')).toBe(false);
    await driver.set('foo', 1);
    expect(await driver.has('foo')).toBe(true);
  });

  it('del removes the value', async () => {
    const driver = localStorageDriver();
    await driver.set('foo', 'bar');
    await driver.del('foo');
    expect(await driver.get('foo')).toBeUndefined();
    expect(await driver.has('foo')).toBe(false);
  });

  it('keys returns all keys', async () => {
    const driver = localStorageDriver();
    await driver.set('a', 1);
    await driver.set('b', 2);
    await driver.set('c', 3);
    expect(await driver.keys()).toEqual(expect.arrayContaining(['a', 'b', 'c']));
    expect((await driver.keys()).length).toBe(3);
  });

  it('keys with prefix filters correctly', async () => {
    const driver = localStorageDriver();
    await driver.set('user:1', 'alice');
    await driver.set('user:2', 'bob');
    await driver.set('post:1', 'hello');
    expect(await driver.keys('user:')).toEqual(expect.arrayContaining(['user:1', 'user:2']));
    expect((await driver.keys('user:')).length).toBe(2);
  });

  it('set/get with complex objects (nested objects, arrays)', async () => {
    const driver = localStorageDriver();
    const value = {
      nested: { arr: [1, 2, 3], flag: true },
      list: ['a', 'b', { c: 4 }],
    };
    await driver.set('complex', value);
    expect(await driver.get('complex')).toEqual(value);
  });

  it('dispose does not clear storage', async () => {
    const driver = localStorageDriver();
    await driver.set('foo', 'bar');
    await driver.dispose();
    expect(await driver.get('foo')).toBe('bar');
    expect(await driver.has('foo')).toBe(true);
    expect((await driver.keys()).length).toBe(1);
  });

  it('exposes a shared backendId across factory instances', () => {
    const a = localStorageDriver();
    const b = localStorageDriver();
    expect(a.backendId).toBe('localStorage');
    expect(b.backendId).toBe(a.backendId);
  });

  it('atom with two localStorage drivers does not lose data on set', async () => {
    const a = atom<string>('dup-ls-key', withDriver([localStorageDriver(), localStorageDriver()]));

    await a.set('hello');
    expect(await a.get()).toBe('hello');
    expect(await a.has()).toBe(true);

    a.dispose();
  });

  it('two atoms with separate localStorageDriver instances receive change events', async () => {
    const a = atom<string>('sync-key', withDriver(localStorageDriver()));
    const b = atom<string>('sync-key', withDriver(localStorageDriver()));

    const changes: unknown[] = [];
    a.addEventListener('change', (e) => changes.push((e as CustomEvent).detail.value));

    await b.set('from-b');

    expect(changes).toEqual(['from-b']);
    expect(await a.get()).toBe('from-b');

    a.dispose();
    b.dispose();
  });
});
