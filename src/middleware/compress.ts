import type { MiddlewareFunction } from '../types';

export interface CompressOptions {
  compress: (data: string) => Promise<string> | string;
  decompress: (data: string) => Promise<string> | string;
}

export function compress(options: CompressOptions): MiddlewareFunction {
  return async (ctx, next) => {
    if (ctx.operation === 'set' && ctx.value !== undefined) {
      const json = JSON.stringify(ctx.value);
      const compressed = await options.compress(json);
      ctx.value = compressed;
      ctx.meta.cmp = 1;
    }

    await next();

    if (
      (ctx.operation === 'get' || ctx.operation === 'refresh') &&
      ctx.value !== undefined &&
      ctx.meta.cmp === 1
    ) {
      try {
        const decompressed = await options.decompress(ctx.value as string);
        ctx.value = JSON.parse(decompressed);
      } catch (err) {
        ctx.value = undefined;
        ctx.reportError(err instanceof Error ? err : new Error(String(err)));
      }
    }
  };
}
