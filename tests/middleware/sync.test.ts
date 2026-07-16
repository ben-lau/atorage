import { describe, expect, it, vi } from 'vitest';
import { atom } from '../../src/atom';
import { withDriver, withMiddleware } from '../../src/modifiers';
import { memoryDriver } from '../../src/drivers/memory';
import { sync } from '../../src/middleware/sync';
import type { MiddlewareWithHooks } from '../../src/types';

describe('sync middleware', () => {
  it('refreshes same-key peers', async () => {
    const driver = memoryDriver();
    const a = atom<string>('k', withDriver(driver), withMiddleware(sync()));
    const b = atom<string>('k', withDriver(driver), withMiddleware(sync()));
    const onChange = vi.fn();
    b.addEventListener('change', (e) => onChange((e as CustomEvent).detail.value));
    await a.set('hello');
    expect(onChange).toHaveBeenCalledWith('hello');
  });

  it('does not sync atoms without sync middleware', async () => {
    const driver = memoryDriver();
    const a = atom<string>('k', withDriver(driver), withMiddleware(sync()));
    const b = atom<string>('k', withDriver(driver));
    const onChange = vi.fn();
    b.addEventListener('change', onChange);
    await a.set('hello');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('matches by key only — peer refreshes its own driver', async () => {
    const d1 = memoryDriver();
    const d2 = memoryDriver();
    const a = atom<string>('k', withDriver(d1), withMiddleware(sync()));
    const b = atom<string>('k', withDriver(d2), withMiddleware(sync()));
    const onDelete = vi.fn();
    b.addEventListener('delete', onDelete);

    await a.set('hello');

    // Same key → sync fires refresh on b; b's empty store yields delete.
    expect(onDelete).toHaveBeenCalledOnce();
    expect(await a.get()).toBe('hello');
    expect(await b.get()).toBeUndefined();
  });

  it('peer refresh failure does not reject the source set', async () => {
    const driver = memoryDriver();
    const boom: MiddlewareWithHooks = {
      handle: async (ctx, next) => {
        if (ctx.operation === 'refresh') throw new Error('peer refresh failed');
        await next();
      },
    };
    const a = atom<string>('k', withDriver(driver), withMiddleware(sync()));
    const b = atom<string>('k', withDriver(driver), withMiddleware(sync(), boom));

    await expect(a.set('hello')).resolves.toBeUndefined();
    expect(await a.get()).toBe('hello');

    a.dispose();
    b.dispose();
  });
});
