import type { MiddlewareFunction, MiddlewareWithHooks } from '../types';

export interface DebounceMiddleware extends MiddlewareWithHooks {
  flush(): Promise<void>;
}

export function debounce(ms: number): DebounceMiddleware {
  let pendingValue: unknown = undefined;
  let pendingMeta: Record<string, unknown> = {};
  let hasPending = false;
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pendingNext: (() => Promise<void>) | null = null;
  let pendingCtx: Parameters<MiddlewareFunction>[0] | null = null;
  let errorReporter: ((err: Error) => void) | null = null;

  function clearTimer() {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function clearPending() {
    clearTimer();
    hasPending = false;
    pendingValue = undefined;
    pendingMeta = {};
    pendingNext = null;
    pendingCtx = null;
  }

  async function doFlush(): Promise<void> {
    clearTimer();
    if (disposed || !hasPending || !pendingNext || !pendingCtx) return;

    pendingCtx.value = pendingValue;
    pendingCtx.meta = { ...pendingMeta };
    hasPending = false;
    pendingValue = undefined;
    pendingMeta = {};
    const flush = pendingNext;
    pendingNext = null;
    pendingCtx = null;
    try {
      await flush();
    } catch (err) {
      if (errorReporter) {
        errorReporter(err instanceof Error ? err : new Error(String(err)));
      }
    }
  }

  const handle: MiddlewareFunction = async (ctx, next) => {
    if (ctx.operation === 'set') {
      pendingValue = ctx.value;
      pendingMeta = { ...ctx.meta };
      hasPending = true;
      errorReporter = ctx.reportError;

      clearTimer();

      pendingCtx = ctx;
      pendingNext = next;

      timer = setTimeout(doFlush, ms);

      return;
    }

    if ((ctx.operation === 'get' || ctx.operation === 'has') && hasPending) {
      ctx.value = pendingValue;
      Object.assign(ctx.meta, pendingMeta);
      return;
    }

    if (ctx.operation === 'del' || ctx.operation === 'refresh') {
      clearPending();
    }

    await next();
  };

  return {
    handle,
    flush: doFlush,
    onDispose() {
      disposed = true;
      clearPending();
    },
  };
}
