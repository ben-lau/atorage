import type { MiddlewareFunction, MiddlewareWithHooks } from '../types';

interface Subscriber {
  atomKey: string;
  atomId: string;
  refresh: () => Promise<void>;
}

interface ChannelEntry {
  bc: BroadcastChannel;
  subscribers: Subscriber[];
}

type ChannelPool = Map<string, ChannelEntry>;

const channelPool: ChannelPool = new Map();

function resolveChannelId(customChannel: string | undefined, atomKey: string): string {
  return customChannel ?? `atorage:${atomKey}`;
}

function routeMessage(entry: ChannelEntry, event: MessageEvent): void {
  const msgKey = event.data?.key;
  if (typeof msgKey !== 'string') return;

  for (const sub of entry.subscribers.slice()) {
    if (sub.atomKey === msgKey) {
      void sub.refresh();
    }
  }
}

function ensureChannelEntry(channelId: string): ChannelEntry {
  let entry = channelPool.get(channelId);
  if (!entry) {
    const bc = new BroadcastChannel(channelId);
    entry = { bc, subscribers: [] };
    channelPool.set(channelId, entry);
    bc.onmessage = (event) => routeMessage(entry!, event);
  }
  return entry;
}

function subscribe(
  channelId: string,
  atomKey: string,
  atomId: string,
  refresh: () => Promise<void>,
): () => void {
  const entry = ensureChannelEntry(channelId);
  const subscriber: Subscriber = { atomKey, atomId, refresh };
  entry.subscribers.push(subscriber);

  return () => {
    const current = channelPool.get(channelId);
    if (!current) return;

    const index = current.subscribers.indexOf(subscriber);
    if (index >= 0) current.subscribers.splice(index, 1);

    if (current.subscribers.length === 0) {
      current.bc.close();
      channelPool.delete(channelId);
    }
  };
}

export function tabSync(channel?: string): MiddlewareWithHooks {
  const subscriptions = new Map<string, () => void>();

  const handle: MiddlewareFunction = async (ctx, next) => {
    await next();

    if ((ctx.operation === 'set' || ctx.operation === 'del') && !ctx.isWriteback) {
      try {
        const channelId = resolveChannelId(channel, ctx.key);
        const entry = ensureChannelEntry(channelId);
        entry.bc.postMessage({ type: ctx.operation, key: ctx.key });
      } catch {
        // BroadcastChannel may not be available
      }
    }
  };

  return {
    handle,

    onInit({ key, atomId, refresh }) {
      try {
        const channelId = resolveChannelId(channel, key);
        const unsubscribe = subscribe(channelId, key, atomId, refresh);
        subscriptions.set(atomId, unsubscribe);
      } catch {
        // BroadcastChannel may not be available
      }
    },

    onDispose({ atomId }) {
      const unsubscribe = subscriptions.get(atomId);
      if (!unsubscribe) return;
      unsubscribe();
      subscriptions.delete(atomId);
    },
  };
}
