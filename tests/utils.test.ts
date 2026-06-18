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
  });
});
