import { atom } from '../../src/atom';
import { withDriver } from '../../src/modifiers';
import { memoryDriver } from '../../src/drivers/memory';
import { eventBus } from '../../src/core/event-bus';

describe('data integrity edge cases', () => {
  afterEach(() => {
    eventBus._clear();
  });

  describe('primitive type roundtrip', () => {
    it('string roundtrip', async () => {
      const a = atom<string>('k', withDriver(memoryDriver()));
      await a.set('hello world');
      expect(await a.get()).toBe('hello world');
      a.dispose();
    });

    it('number roundtrip', async () => {
      const a = atom<number>('k', withDriver(memoryDriver()));
      await a.set(42);
      expect(await a.get()).toBe(42);
      a.dispose();
    });

    it('boolean roundtrip', async () => {
      const driver = memoryDriver();
      const t = atom<boolean>('t', withDriver(driver));
      const f = atom<boolean>('f', withDriver(driver));
      await t.set(true);
      await f.set(false);
      expect(await t.get()).toBe(true);
      expect(await f.get()).toBe(false);
      t.dispose();
      f.dispose();
    });

    it('null roundtrip, has() returns true', async () => {
      const a = atom<null>('k', withDriver(memoryDriver()));
      await a.set(null);
      expect(await a.get()).toBeNull();
      expect(await a.has()).toBe(true);
      a.dispose();
    });
  });

  describe('composite type roundtrip', () => {
    it('plain object roundtrip', async () => {
      const a = atom<{ name: string; age: number }>('k', withDriver(memoryDriver()));
      await a.set({ name: 'Alice', age: 30 });
      expect(await a.get()).toEqual({ name: 'Alice', age: 30 });
      a.dispose();
    });

    it('deeply nested object roundtrip', async () => {
      const nested = {
        level1: {
          level2: {
            level3: {
              value: 'deep',
              list: [1, 2, { nested: true }],
            },
          },
        },
      };
      const a = atom<typeof nested>('k', withDriver(memoryDriver()));
      await a.set(nested);
      expect(await a.get()).toEqual(nested);
      a.dispose();
    });

    it('array roundtrip', async () => {
      const a = atom<number[]>('k', withDriver(memoryDriver()));
      await a.set([1, 2, 3, 4, 5]);
      expect(await a.get()).toEqual([1, 2, 3, 4, 5]);
      a.dispose();
    });

    it('array of objects roundtrip', async () => {
      const data = [
        { id: 1, name: 'Alice' },
        { id: 2, name: 'Bob' },
        { id: 3, name: 'Charlie' },
      ];
      const a = atom<typeof data>('k', withDriver(memoryDriver()));
      await a.set(data);
      expect(await a.get()).toEqual(data);
      a.dispose();
    });
  });

  describe('boundary values', () => {
    it('empty string roundtrip, has() returns true', async () => {
      const a = atom<string>('k', withDriver(memoryDriver()));
      await a.set('');
      expect(await a.get()).toBe('');
      expect(await a.has()).toBe(true);
      a.dispose();
    });

    it('zero roundtrip, has() returns true', async () => {
      const a = atom<number>('k', withDriver(memoryDriver()));
      await a.set(0);
      expect(await a.get()).toBe(0);
      expect(await a.has()).toBe(true);
      a.dispose();
    });

    it('false roundtrip, has() returns true', async () => {
      const a = atom<boolean>('k', withDriver(memoryDriver()));
      await a.set(false);
      expect(await a.get()).toBe(false);
      expect(await a.has()).toBe(true);
      a.dispose();
    });

    it('NaN preserved in memoryDriver', async () => {
      const a = atom<number>('k', withDriver(memoryDriver()));
      await a.set(NaN);
      const val = await a.get();
      expect(val).toBeNaN();
      a.dispose();
    });

    it('Infinity and -Infinity preserved in memoryDriver', async () => {
      const driver = memoryDriver();
      const pos = atom<number>('pos', withDriver(driver));
      const neg = atom<number>('neg', withDriver(driver));
      await pos.set(Infinity);
      await neg.set(-Infinity);
      expect(await pos.get()).toBe(Infinity);
      expect(await neg.get()).toBe(-Infinity);
      pos.dispose();
      neg.dispose();
    });
  });

  describe('undefined vs null semantics', () => {
    it('get returns undefined and has() false for unset key', async () => {
      const a = atom<string>('never-set', withDriver(memoryDriver()));
      expect(await a.get()).toBeUndefined();
      expect(await a.has()).toBe(false);
      a.dispose();
    });

    it('get returns undefined after set then del', async () => {
      const a = atom<string>('k', withDriver(memoryDriver()));
      await a.set('value');
      await a.del();
      expect(await a.get()).toBeUndefined();
      expect(await a.has()).toBe(false);
      a.dispose();
    });

    it('set(null) returns null, distinct from undefined', async () => {
      const a = atom<string | null>('k', withDriver(memoryDriver()));
      await a.set(null);
      const val = await a.get();
      expect(val).toBeNull();
      expect(val).not.toBeUndefined();
      expect(await a.has()).toBe(true);
      a.dispose();
    });
  });

  describe('large data', () => {
    it('1000-element array roundtrip', async () => {
      const data = Array.from({ length: 1000 }, (_, i) => ({ id: i, value: `item-${i}` }));
      const a = atom<typeof data>('k', withDriver(memoryDriver()));
      await a.set(data);
      const result = await a.get();
      expect(result).toHaveLength(1000);
      expect(result![0]).toEqual({ id: 0, value: 'item-0' });
      expect(result![999]).toEqual({ id: 999, value: 'item-999' });
      a.dispose();
    });

    it('10-level nested object roundtrip', async () => {
      let obj: Record<string, unknown> = { leaf: 'value' };
      for (let i = 0; i < 10; i++) {
        obj = { [`level${i}`]: obj };
      }

      const a = atom<typeof obj>('k', withDriver(memoryDriver()));
      await a.set(obj);
      const result = await a.get();
      expect(result).toEqual(obj);
      a.dispose();
    });
  });

  describe('value overwrite', () => {
    it('get returns the last set value after multiple sets', async () => {
      const a = atom<string>('k', withDriver(memoryDriver()));
      await a.set('first');
      await a.set('second');
      await a.set('third');
      expect(await a.get()).toBe('third');
      a.dispose();
    });

    it('values of different types can overwrite each other (typed as any)', async () => {
      const a = atom<any>('k', withDriver(memoryDriver()));
      await a.set('string');
      expect(await a.get()).toBe('string');

      await a.set(42);
      expect(await a.get()).toBe(42);

      await a.set({ complex: true });
      expect(await a.get()).toEqual({ complex: true });

      a.dispose();
    });
  });
});
