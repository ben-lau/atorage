import type { MiddlewareWithHooks, MiddlewareFunction } from '../types';

export interface CachedMiddleware extends MiddlewareWithHooks {
  clear(): void;
}

interface CacheEntry {
  value: unknown;
  meta: Record<string, unknown>;
}

export function cached(): CachedMiddleware {
  const caches = new Map<string, CacheEntry>();

  const handle: MiddlewareFunction = async (ctx, next) => {
    if (ctx.operation === 'get' && caches.has(ctx.key)) {
      const entry = caches.get(ctx.key)!;
      ctx.value = entry.value;
      Object.assign(ctx.meta, entry.meta);
      return;
    }

    // On set: remember the value as seen at this layer (before inner
    // encrypt/compress), but only commit to cache after next() succeeds.
    // Caching post-next would store ciphertext when transforms are inside.
    if (ctx.operation === 'set') {
      const snapshot: CacheEntry = {
        value: ctx.value,
        meta: { ...ctx.meta },
      };
      await next();
      caches.set(ctx.key, snapshot);
      return;
    }

    await next();

    if (ctx.operation === 'get' || ctx.operation === 'refresh') {
      caches.set(ctx.key, { value: ctx.value, meta: { ...ctx.meta } });
    } else if (ctx.operation === 'del') {
      caches.delete(ctx.key);
    }
  };

  return {
    handle,
    clear() {
      caches.clear();
    },
    onDispose() {
      caches.clear();
    },
  };
}
