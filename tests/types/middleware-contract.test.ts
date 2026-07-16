import { describe, expect, it, vi } from 'vitest';
import type { MiddlewareContext, MiddlewareInit, MiddlewareWithHooks } from '../../src/types';

describe('middleware contract', () => {
  it('MiddlewareInit exposes stable refresh', async () => {
    const refresh = vi.fn(async () => {});
    const init: MiddlewareInit = {
      key: 'k',
      atomId: 'atom_1',
      refresh,
    };
    await init.refresh();
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('MiddlewareContext carries refresh operation and atomId', () => {
    const ctx = {
      key: 'k',
      atomId: 'atom_1',
      operation: 'refresh' as const,
      meta: {},
      requestWriteback() {},
      requestDelete() {},
      reportError() {},
      refresh: async () => {},
    } satisfies MiddlewareContext;
    expect(ctx.operation).toBe('refresh');
    expect(ctx.atomId).toBe('atom_1');
  });

  it('MiddlewareWithHooks has no onExternalChange', () => {
    const mw: MiddlewareWithHooks = {
      handle: async (_ctx, next) => next(),
      onInit() {},
      onDispose() {},
    };
    expect('onExternalChange' in mw).toBe(false);
  });
});
