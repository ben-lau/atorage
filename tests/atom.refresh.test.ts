import { describe, expect, it, vi } from 'vitest';
import { atom } from '../src/atom';
import { withDriver, withMiddleware } from '../src/modifiers';
import { memoryDriver } from '../src/drivers/memory';
import { wrap } from '../src/core/wrap';
import type { MiddlewareInit, MiddlewareWithHooks } from '../src/types';

describe('atom refresh', () => {
  it('reads through driver and emits change without writing', async () => {
    const driver = memoryDriver();
    await driver.set('k', wrap('from-driver', {}));

    let refresh!: () => Promise<void>;
    const capture: MiddlewareWithHooks = {
      handle: async (_ctx, next) => next(),
      onInit(init: MiddlewareInit) {
        refresh = init.refresh;
      },
    };

    const a = atom<string>('k', withDriver(driver), withMiddleware(capture));
    const onChange = vi.fn();
    a.addEventListener('change', onChange);

    await refresh();
    expect(onChange).toHaveBeenCalledOnce();
    const detail = (onChange.mock.calls[0]![0] as CustomEvent).detail;
    expect(detail.value).toBe('from-driver');
  });

  it('does not notify peer atoms automatically (no event bus)', async () => {
    const driver = memoryDriver();
    const a = atom<string>('k', withDriver(driver));
    const b = atom<string>('k', withDriver(driver));
    const onChange = vi.fn();
    b.addEventListener('change', onChange);
    await a.set('x');
    expect(onChange).not.toHaveBeenCalled();
  });
});
