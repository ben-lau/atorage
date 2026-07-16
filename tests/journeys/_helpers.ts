import { atom } from '../../src/atom';
import { withDriver, withMiddleware } from '../../src/modifiers';
import { memoryDriver } from '../../src/drivers/memory';
import type { Atom, Driver, Middleware } from '../../src/types';

export const simpleEncryptor = {
  encrypt: (data: string) => data.split('').reverse().join(''),
  decrypt: (data: string) => data.split('').reverse().join(''),
};

export const identityCompress = {
  compress: (data: string) => `c:${data}`,
  decompress: (data: string) => data.slice(2),
};

/** Wait for the next matching DOM event on an atom. */
export function waitForEvent<T = unknown>(
  target: Atom<T>,
  type: 'change' | 'delete' | 'error',
): Promise<CustomEvent> {
  return new Promise((resolve) => {
    target.addEventListener(type, (e) => resolve(e as CustomEvent), { once: true });
  });
}

/** Two same-key atoms sharing one driver (typical sync peer setup). */
export function createPeerPair<T>(
  key: string,
  middleware: Middleware[] = [],
  driver: Driver = memoryDriver(),
): { driver: Driver; a: Atom<T>; b: Atom<T> } {
  const a = atom<T>(key, withDriver(driver), withMiddleware(...middleware));
  const b = atom<T>(key, withDriver(driver), withMiddleware(...middleware));
  return { driver, a, b };
}

// ── BroadcastChannel mock (for tabSync journeys) ──────────────

const channelsByName = new Map<string, MockBroadcastChannel[]>();

export class MockBroadcastChannel {
  name: string;
  closed = false;
  onmessage: ((event: MessageEvent) => void) | null = null;

  constructor(name: string) {
    this.name = name;
    const list = channelsByName.get(name) ?? [];
    list.push(this);
    channelsByName.set(name, list);
  }

  postMessage(msg: unknown) {
    if (this.closed) return;
    for (const peer of channelsByName.get(this.name) ?? []) {
      if (peer !== this && !peer.closed && peer.onmessage) {
        peer.onmessage({ data: msg } as MessageEvent);
      }
    }
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    const list = channelsByName.get(this.name);
    if (!list) return;
    const idx = list.indexOf(this);
    if (idx >= 0) list.splice(idx, 1);
    if (list.length === 0) channelsByName.delete(this.name);
  }
}

export function installMockBroadcastChannel(): void {
  channelsByName.clear();
  globalThis.BroadcastChannel = MockBroadcastChannel as unknown as typeof BroadcastChannel;
}

export function resetMockBroadcastChannels(): void {
  channelsByName.clear();
}

/** Simulate a message from another browsing context (same-channel onmessage). */
export function injectBroadcastMessage(channelName: string, data: unknown): void {
  for (const ch of channelsByName.get(channelName) ?? []) {
    if (!ch.closed) {
      ch.onmessage?.({ data } as MessageEvent);
    }
  }
}
