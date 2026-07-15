// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { indexedDBDriver } from '../../src/drivers/indexed-db';

let counter = 0;
let driver: ReturnType<typeof indexedDBDriver>;

function createDriver() {
  return indexedDBDriver({ dbName: `test-${++counter}` });
}

afterEach(async () => {
  if (driver) await driver.dispose();
});

describe('indexedDBDriver', () => {
  it('available() returns true', () => {
    driver = createDriver();
    expect(driver.available!()).toBe(true);
  });

  it('set then get returns the value', async () => {
    driver = createDriver();
    await driver.set('foo', 'bar');
    expect(await driver.get('foo')).toBe('bar');
    await driver.set('num', 42);
    expect(await driver.get('num')).toBe(42);
  });

  it('get non-existent key returns undefined', async () => {
    driver = createDriver();
    expect(await driver.get('missing')).toBeUndefined();
    expect(await driver.get('missing')).not.toBeNull();
  });

  it('has returns true/false correctly', async () => {
    driver = createDriver();
    expect(await driver.has('foo')).toBe(false);
    await driver.set('foo', 1);
    expect(await driver.has('foo')).toBe(true);
  });

  it('del removes the value', async () => {
    driver = createDriver();
    await driver.set('foo', 'bar');
    await driver.del('foo');
    expect(await driver.get('foo')).toBeUndefined();
    expect(await driver.has('foo')).toBe(false);
  });

  it('keys returns all keys', async () => {
    driver = createDriver();
    await driver.set('a', 1);
    await driver.set('b', 2);
    await driver.set('c', 3);
    expect(await driver.keys()).toEqual(expect.arrayContaining(['a', 'b', 'c']));
    expect((await driver.keys()).length).toBe(3);
  });

  it('keys with prefix filters correctly', async () => {
    driver = createDriver();
    await driver.set('user:1', 'alice');
    await driver.set('user:2', 'bob');
    await driver.set('post:1', 'hello');
    expect(await driver.keys('user:')).toEqual(expect.arrayContaining(['user:1', 'user:2']));
    expect((await driver.keys('user:')).length).toBe(2);
  });

  it('batch applies multiple operations in one transaction', async () => {
    driver = createDriver();
    await driver.batch!([
      { type: 'set', key: 'a', value: 1 },
      { type: 'set', key: 'b', value: 2 },
      { type: 'del', key: 'a' },
    ]);
    expect(await driver.get('a')).toBeUndefined();
    expect(await driver.get('b')).toBe(2);
  });

  it('stores complex objects without JSON serialization', async () => {
    driver = createDriver();
    const date = new Date('2024-06-15T10:00:00Z');
    const value = {
      nested: { arr: [1, 2, 3], date },
      list: ['a', 'b', { c: 4 }],
    };
    await driver.set('complex', value);
    const retrieved = (await driver.get('complex')) as typeof value;
    expect(retrieved).toEqual(value);
    expect(retrieved.nested.date).toBeInstanceOf(Date);
    expect(retrieved.nested.date.getTime()).toBe(date.getTime());
  });

  it('dispose closes the database', async () => {
    const dbName = `test-${++counter}`;
    driver = indexedDBDriver({ dbName });
    await driver.set('foo', 'bar');

    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(dbName);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    db.close();

    await driver.dispose();

    expect(await driver.get('foo')).toBe('bar');

    const db2 = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(dbName);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    db2.close();
  });

  it('same dbName with different storeNames can both read and write', async () => {
    const dbName = `test-${++counter}`;
    const kv = indexedDBDriver({ dbName, storeName: 'kv' });
    const files = indexedDBDriver({ dbName, storeName: 'files' });
    driver = kv;

    await kv.set('a', 1);
    await files.set('f', { name: 'x' });

    expect(await kv.get('a')).toBe(1);
    expect(await files.get('f')).toEqual({ name: 'x' });
    expect(await kv.get('f')).toBeUndefined();
    expect(await files.get('a')).toBeUndefined();

    await files.dispose();
    await kv.dispose();
  });

  it('concurrent first open of two stores on the same db succeeds', async () => {
    const dbName = `test-${++counter}`;
    const kv = indexedDBDriver({ dbName, storeName: 'store-a' });
    const files = indexedDBDriver({ dbName, storeName: 'store-b' });
    driver = kv;

    await Promise.all([kv.set('a', 1), files.set('b', 2)]);

    expect(await kv.get('a')).toBe(1);
    expect(await files.get('b')).toBe(2);

    await files.dispose();
    await kv.dispose();
  });

  it('disposing one store driver keeps the other store usable', async () => {
    const dbName = `test-${++counter}`;
    const kv = indexedDBDriver({ dbName, storeName: 'kv' });
    const files = indexedDBDriver({ dbName, storeName: 'files' });
    driver = kv;

    await kv.set('a', 1);
    await files.set('f', 2);
    await kv.dispose();

    expect(await files.get('f')).toBe(2);
    await files.set('f', 3);
    expect(await files.get('f')).toBe(3);

    await files.dispose();
  });

  it('two drivers with the same dbName and storeName share data', async () => {
    const dbName = `test-${++counter}`;
    const a = indexedDBDriver({ dbName, storeName: 'kv' });
    const b = indexedDBDriver({ dbName, storeName: 'kv' });
    driver = a;

    await a.set('shared', 'yes');
    expect(await b.get('shared')).toBe('yes');

    await b.dispose();
    await a.dispose();
  });

  it('dispose then set reopens the database', async () => {
    const dbName = `test-${++counter}`;
    driver = indexedDBDriver({ dbName });
    await driver.set('foo', 'bar');
    await driver.dispose();
    await driver.set('foo', 'baz');
    expect(await driver.get('foo')).toBe('baz');
  });

  it('disposing one of two same-store drivers keeps the other usable', async () => {
    const dbName = `test-${++counter}`;
    const a = indexedDBDriver({ dbName, storeName: 'kv' });
    const b = indexedDBDriver({ dbName, storeName: 'kv' });
    driver = a;

    await a.set('x', 1);
    await a.dispose();

    expect(await b.get('x')).toBe(1);
    await b.set('x', 2);
    expect(await b.get('x')).toBe(2);

    await b.dispose();
  });
});
