import { atom } from '../../src/atom';
import { withDriver, withMiddleware } from '../../src/modifiers';
import { memoryDriver } from '../../src/drivers/memory';
import { ttl } from '../../src/middleware/ttl';
import { cached } from '../../src/middleware/cached';
import { versioned } from '../../src/middleware/versioned';
import { encrypt } from '../../src/middleware/encrypt';
import { eventBus } from '../../src/core/event-bus';

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
  afterEach(() => {
    eventBus._clear();
  });

  describe('ttl + cached', () => {
    const TTL_MS = 1000;

    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('TTL check runs on cached data because meta is restored', async () => {
      vi.setSystemTime(0);

      const a = atom<string>(
        'ttl-cached-key',
        withDriver(memoryDriver()),
        withMiddleware(ttl(TTL_MS), cached()),
      );

      await a.set('hello');
      await expect(a.get()).resolves.toBe('hello');

      vi.advanceTimersByTime(TTL_MS);
      await expect(a.get()).resolves.toBeUndefined();

      a.dispose();
    });
  });

  describe('versioned + cached', () => {
    it('first get migrates, second get returns cached migrated data', async () => {
      const driver = spyDriver();
      const oldData = { count: 1 };

      const a = atom<{ count: number; new?: boolean }>(
        'versioned-cached-key',
        withDriver(driver),
        withMiddleware(
          versioned({
            current: 2,
            migrate: {
              1: (d: { count: number }) => ({ ...d, new: true }),
            },
          }),
          cached(),
        ),
      );

      await driver.set(a.key, { $v: oldData, $m: { ver: 1 } });

      await expect(a.get()).resolves.toEqual({ count: 1, new: true });
      expect(driver.getCount()).toBe(1);

      await expect(a.get()).resolves.toEqual({ count: 1, new: true });
      expect(driver.getCount()).toBe(1);

      a.dispose();
    });
  });

  describe('encrypt + cached', () => {
    it('encrypt outer layer decrypts cached encrypted value on cache hit', async () => {
      const driver = spyDriver();
      const a = atom<string>(
        'encrypt-cached-key',
        withDriver(driver),
        withMiddleware(encrypt(simpleEncryptor), cached()),
      );

      await a.set('hello');

      const stored = (await driver.get(a.key)) as { $v: string };
      expect(stored.$v).toBe(simpleEncryptor.encrypt(JSON.stringify('hello')));

      await expect(a.get()).resolves.toBe('hello');
      expect(driver.getCount()).toBe(1);

      await expect(a.get()).resolves.toBe('hello');
      expect(driver.getCount()).toBe(1);

      a.dispose();
    });
  });
});
