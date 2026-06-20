import type { MiddlewareFunction } from '../types';

export interface EncryptOptions {
  encrypt: (data: string) => Promise<string> | string;
  decrypt: (data: string) => Promise<string> | string;
}

export function encrypt(options: EncryptOptions): MiddlewareFunction {
  return async (ctx, next) => {
    if (ctx.operation === 'set' && ctx.value !== undefined) {
      const json = JSON.stringify(ctx.value);
      const encrypted = await options.encrypt(json);
      ctx.value = encrypted;
      ctx.meta.enc = 1;
    }

    await next();

    if (ctx.operation === 'get' && ctx.value !== undefined && ctx.meta.enc === 1) {
      try {
        const decrypted = await options.decrypt(ctx.value as string);
        ctx.value = JSON.parse(decrypted);
      } catch (err) {
        ctx.value = undefined;
        ctx.reportError(err instanceof Error ? err : new Error(String(err)));
      }
    }
  };
}
