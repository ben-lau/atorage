import { snapshot, restore, clearByPrefix } from '../src/utils/index';
import { memoryDriver } from '../src/drivers/memory';

describe('utils', () => {
  describe('snapshot', () => {
    it('returns all key-value pairs', async () => {
      const driver = memoryDriver();
      await driver.set('a', 1);
      await driver.set('b', 2);
      await driver.set('c', 3);

      expect(await snapshot({ driver })).toEqual({ a: 1, b: 2, c: 3 });
    });

    it('with prefix filters keys', async () => {
      const driver = memoryDriver();
      await driver.set('user:1', 'alice');
      await driver.set('user:2', 'bob');
      await driver.set('post:1', 'hello');

      expect(await snapshot({ driver, prefix: 'user:' })).toEqual({
        'user:1': 'alice',
        'user:2': 'bob',
      });
    });
  });

  describe('restore', () => {
    it('writes all entries to driver', async () => {
      const driver = memoryDriver();
      await restore({ a: 1, b: 2 }, { driver });

      expect(await driver.get('a')).toBe(1);
      expect(await driver.get('b')).toBe(2);
    });

    it('no-ops on empty data', async () => {
      const driver = memoryDriver();
      await driver.set('existing', 'keep');

      await restore({}, { driver });

      expect(await driver.get('existing')).toBe('keep');
    });

    it('overwrites existing keys', async () => {
      const driver = memoryDriver();
      await driver.set('a', 'old');

      await restore({ a: 'new' }, { driver });

      expect(await driver.get('a')).toBe('new');
    });

    it('falls back to sequential set when driver has no batch', async () => {
      const store = new Map<string, unknown>();
      const setCalls: string[] = [];
      const noBatchDriver = {
        name: 'no-batch',
        async get(key: string) {
          return store.get(key);
        },
        async set(key: string, value: unknown) {
          setCalls.push(key);
          store.set(key, value);
        },
        async del(key: string) {
          store.delete(key);
        },
        async has(key: string) {
          return store.has(key);
        },
        async keys() {
          return [...store.keys()];
        },
        async dispose() {
          store.clear();
        },
      };

      await restore({ x: 10, y: 20 }, { driver: noBatchDriver });

      expect(setCalls).toEqual(['x', 'y']);
      expect(store.get('x')).toBe(10);
      expect(store.get('y')).toBe(20);
    });

    it('uses driver.batch when available', async () => {
      const store = new Map<string, unknown>();
      const batchCalls: Array<{ type: string; key: string; value?: unknown }[]> = [];
      const batchDriver = {
        name: 'batch-driver',
        async get(key: string) {
          return store.get(key);
        },
        async set(key: string, value: unknown) {
          store.set(key, value);
        },
        async del(key: string) {
          store.delete(key);
        },
        async has(key: string) {
          return store.has(key);
        },
        async keys() {
          return [...store.keys()];
        },
        async dispose() {
          store.clear();
        },
        async batch(ops: { type: string; key: string; value?: unknown }[]) {
          batchCalls.push(ops);
          for (const op of ops) {
            if (op.type === 'set') store.set(op.key, op.value);
          }
        },
      };

      await restore({ a: 1, b: 2 }, { driver: batchDriver });

      expect(batchCalls).toHaveLength(1);
      expect(batchCalls[0]).toEqual([
        { type: 'set', key: 'a', value: 1 },
        { type: 'set', key: 'b', value: 2 },
      ]);
      expect(store.get('a')).toBe(1);
      expect(store.get('b')).toBe(2);
    });
  });

  describe('snapshot → restore round-trip', () => {
    it('preserves data across drivers', async () => {
      const source = memoryDriver();
      await source.set('x', 10);
      await source.set('y', { nested: true });

      const data = await snapshot({ driver: source });

      const target = memoryDriver();
      await restore(data, { driver: target });

      expect(await target.get('x')).toBe(10);
      expect(await target.get('y')).toEqual({ nested: true });
    });
  });

  describe('clearByPrefix', () => {
    it('removes matching keys and returns count', async () => {
      const driver = memoryDriver();
      await driver.set('user:1', 'alice');
      await driver.set('user:2', 'bob');
      await driver.set('post:1', 'hello');

      const count = await clearByPrefix('user:', { driver });

      expect(count).toBe(2);
      expect(await driver.has('user:1')).toBe(false);
      expect(await driver.has('user:2')).toBe(false);
    });

    it('does not remove non-matching keys', async () => {
      const driver = memoryDriver();
      await driver.set('user:1', 'alice');
      await driver.set('post:1', 'hello');

      await clearByPrefix('user:', { driver });

      expect(await driver.get('post:1')).toBe('hello');
    });

    it('returns 0 when no keys match the prefix', async () => {
      const driver = memoryDriver();
      await driver.set('post:1', 'hello');

      const count = await clearByPrefix('user:', { driver });
      expect(count).toBe(0);
      expect(await driver.get('post:1')).toBe('hello');
    });

    it('returns 0 on empty driver', async () => {
      const driver = memoryDriver();
      const count = await clearByPrefix('anything:', { driver });
      expect(count).toBe(0);
    });

    it('falls back to sequential del when driver has no batch', async () => {
      const store = new Map<string, unknown>();
      const delCalls: string[] = [];
      const noBatchDriver = {
        name: 'no-batch',
        async get(key: string) {
          return store.get(key);
        },
        async set(key: string, value: unknown) {
          store.set(key, value);
        },
        async del(key: string) {
          delCalls.push(key);
          store.delete(key);
        },
        async has(key: string) {
          return store.has(key);
        },
        async keys(prefix?: string) {
          return [...store.keys()].filter((k) => !prefix || k.startsWith(prefix));
        },
        async dispose() {
          store.clear();
        },
      };

      await noBatchDriver.set('cache:a', 1);
      await noBatchDriver.set('cache:b', 2);
      await noBatchDriver.set('other:x', 3);

      const count = await clearByPrefix('cache:', { driver: noBatchDriver });

      expect(count).toBe(2);
      expect(delCalls).toContain('cache:a');
      expect(delCalls).toContain('cache:b');
      expect(store.has('cache:a')).toBe(false);
      expect(store.has('cache:b')).toBe(false);
      expect(store.has('other:x')).toBe(true);
    });

    it('uses driver.batch when available', async () => {
      const store = new Map<string, unknown>();
      const batchCalls: Array<{ type: string; key: string }[]> = [];
      const batchDriver = {
        name: 'batch-driver',
        async get(key: string) {
          return store.get(key);
        },
        async set(key: string, value: unknown) {
          store.set(key, value);
        },
        async del(key: string) {
          store.delete(key);
        },
        async has(key: string) {
          return store.has(key);
        },
        async keys(prefix?: string) {
          return [...store.keys()].filter((k) => !prefix || k.startsWith(prefix));
        },
        async dispose() {
          store.clear();
        },
        async batch(ops: { type: string; key: string }[]) {
          batchCalls.push(ops);
          for (const op of ops) {
            if (op.type === 'del') store.delete(op.key);
          }
        },
      };

      await batchDriver.set('tmp:1', 'a');
      await batchDriver.set('tmp:2', 'b');

      const count = await clearByPrefix('tmp:', { driver: batchDriver });

      expect(count).toBe(2);
      expect(batchCalls).toHaveLength(1);
      expect(batchCalls[0]).toEqual([
        { type: 'del', key: 'tmp:1' },
        { type: 'del', key: 'tmp:2' },
      ]);
      expect(store.has('tmp:1')).toBe(false);
      expect(store.has('tmp:2')).toBe(false);
    });
  });
});
