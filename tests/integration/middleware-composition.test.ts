import { atom } from '../../src/atom';
import { withDriver, withMiddleware } from '../../src/modifiers';
import { memoryDriver } from '../../src/drivers/memory';
import { ttl } from '../../src/middleware/ttl';
import { versioned } from '../../src/middleware/versioned';
import { encrypt } from '../../src/middleware/encrypt';

const simpleEncryptor = {
  encrypt: (s: string) => s.split('').reverse().join(''),
  decrypt: (s: string) => s.split('').reverse().join(''),
};

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

describe('middleware composition', () => {
  describe('ttl + peek', () => {
    const TTL_MS = 1000;

    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('TTL check runs on every get; peek clears after expired get', async () => {
      vi.setSystemTime(0);

      const a = atom<string>(
        'ttl-peek-key',
        withDriver(memoryDriver()),
        withMiddleware(ttl(TTL_MS)),
      );

      await a.set('hello');
      expect(a.peek()).toBe('hello');
      await expect(a.get()).resolves.toBe('hello');

      vi.advanceTimersByTime(TTL_MS);
      await expect(a.get()).resolves.toBeUndefined();
      expect(a.peek()).toBeUndefined();

      a.dispose();
    });
  });

  describe('versioned + peek', () => {
    it('first get migrates; second get hits driver again; peek holds migrated value', async () => {
      const driver = spyDriver();
      const oldData = { count: 1 };

      const a = atom<{ count: number; new?: boolean }>(
        'versioned-peek-key',
        withDriver(driver),
        withMiddleware(
          versioned({
            current: 2,
            migrate: {
              1: (d: { count: number }) => ({ ...d, new: true }),
            },
          }),
        ),
      );

      await driver.set(a.key, { $v: oldData, $m: { ver: 1 } });

      await expect(a.get()).resolves.toEqual({ count: 1, new: true });
      expect(driver.getCount()).toBe(1);
      expect(a.peek()).toEqual({ count: 1, new: true });

      await expect(a.get()).resolves.toEqual({ count: 1, new: true });
      expect(driver.getCount()).toBe(2);

      a.dispose();
    });
  });

  describe('encrypt + peek', () => {
    it('peek stays plaintext while driver stores ciphertext; every get hits driver', async () => {
      const driver = spyDriver();
      const a = atom<string>(
        'encrypt-peek-key',
        withDriver(driver),
        withMiddleware(encrypt(simpleEncryptor)),
      );

      await a.set('hello');
      expect(a.peek()).toBe('hello');

      const stored = (await driver.get(a.key)) as { $v: string };
      expect(stored.$v).toBe(simpleEncryptor.encrypt(JSON.stringify('hello')));

      const countAfterInspect = driver.getCount();
      await expect(a.get()).resolves.toBe('hello');
      expect(driver.getCount()).toBe(countAfterInspect + 1);
      expect(a.peek()).toBe('hello');

      await expect(a.get()).resolves.toBe('hello');
      expect(driver.getCount()).toBe(countAfterInspect + 2);

      a.dispose();
    });
  });
});
