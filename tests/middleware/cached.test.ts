import { atom } from '../../src/atom';
import { withDriver, withMiddleware } from '../../src/modifiers';
import { memoryDriver } from '../../src/drivers/memory';
import { cached } from '../../src/middleware/cached';
import { compress } from '../../src/middleware/compress';
import { encrypt } from '../../src/middleware/encrypt';
import { sync } from '../../src/middleware/sync';
import { ttl } from '../../src/middleware/ttl';
import { validate } from '../../src/middleware/validate';
import { wrap } from '../../src/core/wrap';
import type { MiddlewareInit, MiddlewareWithHooks } from '../../src/types';

const simpleEncryptor = {
  encrypt: (data: string) => data.split('').reverse().join(''),
  decrypt: (data: string) => data.split('').reverse().join(''),
};

const identityCompress = {
  compress: (data: string) => `c:${data}`,
  decompress: (data: string) => data.slice(2),
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

describe('cached middleware', () => {
  it('first get reads from driver, second get returns cached', async () => {
    const driver = spyDriver();
    const a = atom<string>('cached-key', withDriver(driver), withMiddleware(cached()));

    await driver.set(a.key, { $v: 'stored' });

    await expect(a.get()).resolves.toBe('stored');
    expect(driver.getCount()).toBe(1);

    await expect(a.get()).resolves.toBe('stored');
    expect(driver.getCount()).toBe(1);

    a.dispose();
  });

  it('set updates the cache', async () => {
    const driver = spyDriver();
    const a = atom<string>('cached-key', withDriver(driver), withMiddleware(cached()));

    await a.set('new-value');
    await expect(a.get()).resolves.toBe('new-value');
    expect(driver.getCount()).toBe(0);

    a.dispose();
  });

  it('del clears the cache', async () => {
    const driver = spyDriver();
    const a = atom<string>('cached-key', withDriver(driver), withMiddleware(cached()));

    await a.set('value');
    await a.get();
    expect(driver.getCount()).toBe(0);

    await a.del();
    await expect(a.get()).resolves.toBeUndefined();
    expect(driver.getCount()).toBe(1);

    a.dispose();
  });

  it('refresh bypasses cache and refills from driver', async () => {
    const driver = spyDriver();
    let refresh!: () => Promise<void>;
    const captureRefresh: MiddlewareWithHooks = {
      handle: async (_ctx, next) => next(),
      onInit(init: MiddlewareInit) {
        refresh = init.refresh;
      },
    };
    const a = atom<string>(
      'cached-key',
      withDriver(driver),
      withMiddleware(cached(), captureRefresh),
    );

    await driver.set(a.key, { $v: 'stored' });

    await expect(a.get()).resolves.toBe('stored');
    expect(driver.getCount()).toBe(1);

    await driver.set(a.key, { $v: 'updated' });
    await refresh();

    await expect(a.get()).resolves.toBe('updated');
    expect(driver.getCount()).toBe(2);

    a.dispose();
  });

  it('set caches pre-inner value so cached before encrypt works with validate', async () => {
    const driver = spyDriver();
    const a = atom<{ theme: string }>(
      'cached-key',
      withDriver(driver),
      withMiddleware(
        validate((v) => typeof v === 'object' && v !== null && 'theme' in v),
        cached(),
        encrypt(simpleEncryptor),
      ),
    );

    await a.set({ theme: 'dark' });
    expect(await a.get()).toEqual({ theme: 'dark' });
    expect(driver.getCount()).toBe(0);

    a.dispose();
  });

  it('failed set does not leave a stale cache entry', async () => {
    const driver = memoryDriver();
    const a = atom<string>(
      'cached-key',
      withDriver(driver),
      withMiddleware(cached(), async (ctx, next) => {
        if (ctx.operation === 'set') throw new Error('write failed');
        await next();
      }),
    );

    await expect(a.set('x')).rejects.toThrow('write failed');
    await driver.set(a.key, { $v: 'from-disk' });
    expect(await a.get()).toBe('from-disk');

    a.dispose();
  });

  it('failed set keeps previous successful cache entry', async () => {
    const driver = spyDriver();
    let fail = false;
    const a = atom<string>(
      'cached-key',
      withDriver(driver),
      withMiddleware(cached(), async (ctx, next) => {
        if (ctx.operation === 'set' && fail) throw new Error('write failed');
        await next();
      }),
    );

    await a.set('ok');
    fail = true;
    await expect(a.set('nope')).rejects.toThrow('write failed');

    expect(await a.get()).toBe('ok');
    expect(driver.getCount()).toBe(0);

    a.dispose();
  });

  describe('pre-inner set snapshot vs transform middleware', () => {
    it('cached before compress+encrypt: local get hit stays plaintext under validate', async () => {
      const driver = spyDriver();
      const a = atom<{ theme: string }>(
        'cached-key',
        withDriver(driver),
        withMiddleware(
          validate((v) => typeof v === 'object' && v !== null && 'theme' in v),
          cached(),
          compress(identityCompress),
          encrypt(simpleEncryptor),
        ),
      );

      await a.set({ theme: 'dark' });
      expect(await a.get()).toEqual({ theme: 'dark' });
      expect(await a.get()).toEqual({ theme: 'dark' });
      expect(driver.getCount()).toBe(0);
      expect(JSON.stringify(await driver.get(a.key))).not.toContain('dark');

      a.dispose();
    });

    it('ttl outside + encrypt inside: cache hit still expires via snapshotted meta.exp', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(0);

      const driver = spyDriver();
      const a = atom<string>(
        'cached-key',
        withDriver(driver),
        withMiddleware(ttl(1000), cached(), encrypt(simpleEncryptor)),
      );

      await a.set('hello');
      expect(await a.get()).toBe('hello');
      expect(driver.getCount()).toBe(0);

      vi.advanceTimersByTime(1000);
      expect(await a.get()).toBeUndefined();
      expect(driver.getCount()).toBe(0);

      a.dispose();
      vi.useRealTimers();
    });

    it('cold get from encrypted disk fills cache with plaintext when encrypt is inside', async () => {
      const driver = spyDriver();
      const writer = atom<string>(
        'cached-key',
        withDriver(driver),
        withMiddleware(encrypt(simpleEncryptor)),
      );
      await writer.set('secret');
      writer.dispose();

      const a = atom<string>(
        'cached-key',
        withDriver(driver),
        withMiddleware(
          validate((v) => typeof v === 'string'),
          cached(),
          encrypt(simpleEncryptor),
        ),
      );

      expect(await a.get()).toBe('secret');
      expect(driver.getCount()).toBe(1);
      expect(await a.get()).toBe('secret');
      expect(driver.getCount()).toBe(1);

      a.dispose();
    });

    it('refresh after external ciphertext overwrite updates cache (cached before encrypt)', async () => {
      const driver = spyDriver();
      let refresh!: () => Promise<void>;
      const captureRefresh: MiddlewareWithHooks = {
        handle: async (_ctx, next) => next(),
        onInit(init: MiddlewareInit) {
          refresh = init.refresh;
        },
      };

      const a = atom<string>(
        'cached-key',
        withDriver(driver),
        withMiddleware(cached(), encrypt(simpleEncryptor), captureRefresh),
      );

      await a.set('v1');
      expect(await a.get()).toBe('v1');
      expect(driver.getCount()).toBe(0);

      // Simulate another tab writing ciphertext directly
      const cipher = simpleEncryptor.encrypt(JSON.stringify('v2'));
      await driver.set(a.key, wrap(cipher, { enc: 1 }));
      await refresh();

      expect(await a.get()).toBe('v2');
      expect(driver.getCount()).toBe(1);

      a.dispose();
    });

    it('sync peer refresh with cached before encrypt delivers plaintext', async () => {
      const driver = memoryDriver();
      const stack = [cached(), encrypt(simpleEncryptor), sync()] as const;
      const a = atom<string>('cached-key', withDriver(driver), withMiddleware(...stack));
      const b = atom<string>('cached-key', withDriver(driver), withMiddleware(...stack));

      const onChange = vi.fn();
      b.addEventListener('change', (e) => onChange((e as CustomEvent).detail.value));

      await a.set('hello');
      expect(onChange).toHaveBeenCalledWith('hello');
      expect(await b.get()).toBe('hello');

      a.dispose();
      b.dispose();
    });

    it('encrypt outside cached: set still cache-hits via outer decrypt', async () => {
      const driver = spyDriver();
      const a = atom<string>(
        'cached-key',
        withDriver(driver),
        withMiddleware(encrypt(simpleEncryptor), cached()),
      );

      await a.set('hello');
      // get hit returns ciphertext from cache; encrypt after-hook decrypts
      expect(await a.get()).toBe('hello');
      expect(driver.getCount()).toBe(0);

      a.dispose();
    });

    it('update() with cached before encrypt round-trips plaintext', async () => {
      const driver = memoryDriver();
      const a = atom<number>(
        'cached-key',
        withDriver(driver),
        withMiddleware(cached(), encrypt(simpleEncryptor)),
      );

      await a.set(1);
      expect(await a.update((n) => (n ?? 0) + 1)).toBe(2);
      expect(await a.get()).toBe(2);

      a.dispose();
    });

    it('clear() drops pre-inner snapshot so next get hits driver', async () => {
      const driver = spyDriver();
      const cacheMw = cached();
      const a = atom<string>(
        'cached-key',
        withDriver(driver),
        withMiddleware(cacheMw, encrypt(simpleEncryptor)),
      );

      await a.set('hello');
      expect(await a.get()).toBe('hello');
      expect(driver.getCount()).toBe(0);

      cacheMw.clear();
      expect(await a.get()).toBe('hello');
      expect(driver.getCount()).toBe(1);

      a.dispose();
    });

    it('set snapshot meta keeps outer ttl/version fields, not inner enc flag', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(1000);

      const driver = memoryDriver();
      const a = atom<string>(
        'cached-key',
        withDriver(driver),
        withMiddleware(ttl(5000), cached(), encrypt(simpleEncryptor)),
      );

      await a.set('hello');
      // Disk meta includes enc from inner encrypt
      expect(await a.getMeta()).toMatchObject({ exp: 6000, enc: 1 });
      // Cache hit path still expires using snapshotted exp from outside ttl
      expect(await a.get()).toBe('hello');
      vi.setSystemTime(6000);
      expect(await a.get()).toBeUndefined();

      a.dispose();
      vi.useRealTimers();
    });
  });

  it('onDispose clears cache', async () => {
    const driver = spyDriver();
    const cacheMw = cached();
    const a = atom<string>('cached-key', withDriver(driver), withMiddleware(cacheMw));

    await a.set('value');
    await a.get();
    expect(driver.getCount()).toBe(0);

    a.dispose();

    const a2 = atom<string>('cached-key', withDriver(driver), withMiddleware(cached()));
    await expect(a2.get()).resolves.toBe('value');
    expect(driver.getCount()).toBe(1);

    a2.dispose();
  });
});
