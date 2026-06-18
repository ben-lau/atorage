import type { MiddlewareWithHooks, MiddlewareFunction } from '../types.js';

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

    await next();

    if (ctx.operation === 'get') {
      caches.set(ctx.key, { value: ctx.value, meta: { ...ctx.meta } });
    } else if (ctx.operation === 'set') {
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
    onExternalChange(key: string) {
      caches.delete(key);
    },
    onDispose() {
      caches.clear();
    },
  };
}
