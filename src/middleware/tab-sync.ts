import type { MiddlewareFunction, MiddlewareWithHooks } from '../types.js';
import { eventBus } from '../core/event-bus.js';

export function tabSync(channel?: string): MiddlewareWithHooks {
  let bc: BroadcastChannel | null = null;
  let atomKey = '';
  let initialized = false;

  function ensureChannel(key: string): BroadcastChannel {
    if (!bc) {
      const name = channel ?? `atorage:${key}`;
      bc = new BroadcastChannel(name);
    }
    return bc;
  }

  const handle: MiddlewareFunction = async (ctx, next) => {
    await next();

    if (ctx.operation === 'set' || ctx.operation === 'del') {
      try {
        const ch = ensureChannel(ctx.key);
        ch.postMessage({ type: ctx.operation, key: ctx.key });
      } catch {
        // BroadcastChannel may not be available
      }
    }
  };

  return {
    handle,

    onInit({ key, atomId }) {
      if (initialized) return;
      initialized = true;
      atomKey = key;

      try {
        const ch = ensureChannel(key);
        ch.onmessage = (event) => {
          const type = event.data?.type === 'del' ? 'delete' : 'change';
          eventBus.notify(atomKey, `__cross_tab_${atomId}__`, { type });
        };
      } catch {
        // BroadcastChannel may not be available
      }
    },

    onDispose() {
      if (bc) {
        bc.close();
        bc = null;
      }
      initialized = false;
    },
  };
}
