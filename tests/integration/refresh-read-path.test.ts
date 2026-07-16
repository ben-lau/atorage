import { describe, expect, it, vi } from 'vitest';
import { atom } from '../../src/atom';
import { withDriver, withMiddleware } from '../../src/modifiers';
import { memoryDriver } from '../../src/drivers/memory';
import { encrypt } from '../../src/middleware/encrypt';
import { compress } from '../../src/middleware/compress';
import { cached } from '../../src/middleware/cached';
import { sync } from '../../src/middleware/sync';
import { ttl } from '../../src/middleware/ttl';
import { versioned } from '../../src/middleware/versioned';
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

function captureRefresh(slot: { refresh?: () => Promise<void> }): MiddlewareWithHooks {
  return {
    handle: async (_ctx, next) => next(),
    onInit(init: MiddlewareInit) {
      slot.refresh = init.refresh;
    },
  };
}

describe('refresh read-path alignment', () => {
  it('sync + encrypt delivers plaintext on peer change (not ciphertext)', async () => {
    const driver = memoryDriver();
    const a = atom<string>(
      'secret',
      withDriver(driver),
      withMiddleware(encrypt(simpleEncryptor), sync()),
    );
    const b = atom<string>(
      'secret',
      withDriver(driver),
      withMiddleware(encrypt(simpleEncryptor), cached(), sync()),
    );

    const onChange = vi.fn();
    b.addEventListener('change', (e) => onChange((e as CustomEvent).detail.value));

    await a.set('hello');

    expect(onChange).toHaveBeenCalledWith('hello');
    await expect(b.get()).resolves.toBe('hello');

    a.dispose();
    b.dispose();
  });

  it('sync + compress delivers decompressed value on peer change', async () => {
    const driver = memoryDriver();
    const a = atom<string>(
      'blob',
      withDriver(driver),
      withMiddleware(compress(identityCompress), sync()),
    );
    const b = atom<string>(
      'blob',
      withDriver(driver),
      withMiddleware(compress(identityCompress), sync()),
    );

    const onChange = vi.fn();
    b.addEventListener('change', (e) => onChange((e as CustomEvent).detail.value));

    await a.set('payload');
    expect(onChange).toHaveBeenCalledWith('payload');

    a.dispose();
    b.dispose();
  });

  it('refresh runs ttl expiry and can deleteOnExpire', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);

    const driver = memoryDriver();
    const slot: { refresh?: () => Promise<void> } = {};
    const a = atom<string>(
      'exp',
      withDriver(driver),
      withMiddleware(ttl(1000, { deleteOnExpire: true }), captureRefresh(slot)),
    );

    await a.set('soon');
    vi.setSystemTime(2000);

    const onDelete = vi.fn();
    a.addEventListener('delete', onDelete);
    await slot.refresh!();

    expect(onDelete).toHaveBeenCalledOnce();
    expect(await driver.get(a.key)).toBeUndefined();

    a.dispose();
    vi.useRealTimers();
  });

  it('refresh migrates and writeback without re-triggering sync', async () => {
    const driver = memoryDriver();
    await driver.set('v', wrap({ count: 1 }, { ver: 0 }));

    let syncNotifies = 0;
    const countingSync: MiddlewareWithHooks = {
      handle: async (ctx, next) => {
        await next();
        if ((ctx.operation === 'set' || ctx.operation === 'del') && !ctx.isWriteback) {
          syncNotifies++;
        }
      },
    };

    const slot: { refresh?: () => Promise<void> } = {};
    const a = atom<{ count: number }>(
      'v',
      withDriver(driver),
      withMiddleware(
        versioned({
          current: 1,
          migrate: {
            0: (data: { count: number }) => ({ count: data.count + 10 }),
          },
        }),
        countingSync,
        captureRefresh(slot),
      ),
    );

    const onChange = vi.fn();
    a.addEventListener('change', (e) => onChange((e as CustomEvent).detail.value));

    await slot.refresh!();

    expect(onChange).toHaveBeenCalledWith({ count: 11 });
    expect(await a.get()).toEqual({ count: 11 });
    expect(await a.getMeta()).toEqual({ ver: 1 });
    // Writeback must not count as a sync-triggering local set.
    expect(syncNotifies).toBe(0);

    a.dispose();
  });
});
