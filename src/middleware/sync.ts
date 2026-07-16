import type { MiddlewareFunction, MiddlewareWithHooks } from '../types';

interface Peer {
  atomId: string;
  key: string;
  refresh: () => Promise<void>;
}

const pools = new Map<string, Set<Peer>>();

/**
 * Same-tab sync by storage key only.
 * On non-writeback set/del, peers run `refresh` against their own drivers —
 * configure matching backends at the call site.
 */
export function sync(): MiddlewareWithHooks {
  const localPeers = new Map<string, Peer>();

  const handle: MiddlewareFunction = async (ctx, next) => {
    await next();

    if (ctx.operation !== 'set' && ctx.operation !== 'del') return;
    if (ctx.isWriteback) return;

    const pool = pools.get(ctx.key);
    if (!pool) return;

    const tasks: Promise<void>[] = [];
    for (const peer of pool) {
      if (peer.atomId === ctx.atomId) continue;
      tasks.push(peer.refresh());
    }
    // Peer refresh is best-effort: never fail the source set/del after a successful write.
    await Promise.allSettled(tasks);
  };

  return {
    handle,

    onInit(init) {
      const peer: Peer = {
        atomId: init.atomId,
        key: init.key,
        refresh: init.refresh,
      };
      localPeers.set(init.atomId, peer);

      let set = pools.get(init.key);
      if (!set) {
        set = new Set();
        pools.set(init.key, set);
      }
      set.add(peer);
    },

    onDispose({ atomId }) {
      const peer = localPeers.get(atomId);
      if (!peer) return;
      localPeers.delete(atomId);

      const set = pools.get(peer.key);
      if (!set) return;
      set.delete(peer);
      if (set.size === 0) pools.delete(peer.key);
    },
  };
}
