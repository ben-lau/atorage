// @vitest-environment happy-dom
import { tabSync } from '../../src/middleware/tab-sync';
import { atom } from '../../src/atom';
import { withDriver, withMiddleware, withScope } from '../../src/modifiers';
import { memoryDriver } from '../../src/drivers/memory';
import { createScope } from '../../src/scope';
import { wrap } from '../../src/core/wrap';

const messages: { channel: string; data: unknown }[] = [];
const closedChannels: string[] = [];
const channelInstances: MockBroadcastChannel[] = [];
const channelsByName = new Map<string, MockBroadcastChannel[]>();

class MockBroadcastChannel {
  name: string;
  closed = false;
  onmessage: ((event: MessageEvent) => void) | null = null;

  constructor(name: string) {
    this.name = name;
    channelInstances.push(this);
    const list = channelsByName.get(name) ?? [];
    list.push(this);
    channelsByName.set(name, list);
  }

  postMessage(msg: unknown) {
    if (this.closed) return;

    messages.push({ channel: this.name, data: msg });

    for (const peer of channelsByName.get(this.name) ?? []) {
      if (peer !== this && !peer.closed && peer.onmessage) {
        peer.onmessage({ data: msg } as MessageEvent);
      }
    }
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    closedChannels.push(this.name);

    const list = channelsByName.get(this.name);
    if (list) {
      const idx = list.indexOf(this);
      if (idx >= 0) list.splice(idx, 1);
      if (list.length === 0) channelsByName.delete(this.name);
    }
  }
}

/** Inject a BroadcastChannel message (production onmessage is fire-and-forget). */
function injectMessage(channel: MockBroadcastChannel, data: unknown): void {
  channel.onmessage?.({ data } as MessageEvent);
}

/** Wait until an assertion about async refresh side effects becomes true. */
async function whenRefreshed(assertion: () => void): Promise<void> {
  await vi.waitFor(assertion);
}

/** Give in-flight refresh pipelines a chance to finish before negative assertions. */
async function settleRefresh(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
}

describe('tabSync middleware', () => {
  beforeEach(() => {
    messages.length = 0;
    closedChannels.length = 0;
    channelInstances.length = 0;
    channelsByName.clear();
    globalThis.BroadcastChannel = MockBroadcastChannel as unknown as typeof BroadcastChannel;
  });

  function createAtom(key = 'tab-sync-key', channel?: string) {
    const mw = tabSync(channel);
    const a = atom<string>(key, withDriver(memoryDriver()), withMiddleware(mw));
    return { atom: a, mw };
  }

  it('set broadcasts a message with type set and the key', async () => {
    const { atom: a } = createAtom('my-key');

    await a.set('hello');

    expect(messages).toEqual([{ channel: 'atorage:my-key', data: { type: 'set', key: 'my-key' } }]);

    a.dispose();
  });

  it('del broadcasts a message with type del and the key', async () => {
    const { atom: a } = createAtom('del-key');

    await a.set('value');
    messages.length = 0;

    await a.del();

    expect(messages).toEqual([
      { channel: 'atorage:del-key', data: { type: 'del', key: 'del-key' } },
    ]);

    a.dispose();
  });

  it('get does not broadcast', async () => {
    const { atom: a } = createAtom('get-key');

    await a.set('value');
    messages.length = 0;

    await a.get();

    expect(messages).toEqual([]);

    a.dispose();
  });

  it('uses custom channel name when provided', async () => {
    const { atom: a } = createAtom('custom-key', 'my-custom-channel');

    await a.set('hello');

    expect(messages).toEqual([
      { channel: 'my-custom-channel', data: { type: 'set', key: 'custom-key' } },
    ]);

    a.dispose();
  });

  it('dispose closes the channel when last subscriber leaves', async () => {
    const { atom: a } = createAtom('dispose-key');

    await a.set('hello');
    expect(closedChannels).toEqual([]);

    a.dispose();

    expect(closedChannels).toEqual(['atorage:dispose-key']);
  });

  it('incoming message triggers refresh and instance events', async () => {
    const driver = memoryDriver();
    const a = atom<string>('test-key', withDriver(driver), withMiddleware(tabSync()));
    const onDelete = vi.fn();
    const onChange = vi.fn();
    a.addEventListener('delete', onDelete);
    a.addEventListener('change', onChange);

    const channel = channelInstances[0];
    expect(channel).toBeDefined();

    injectMessage(channel!, { type: 'del', key: 'test-key' });
    await whenRefreshed(() => expect(onDelete).toHaveBeenCalledOnce());

    await driver.set('test-key', wrap('remote', {}));
    injectMessage(channel!, { type: 'set', key: 'test-key' });
    await whenRefreshed(() => {
      expect(onChange).toHaveBeenCalled();
      expect((onChange.mock.calls.at(-1)![0] as CustomEvent).detail.value).toBe('remote');
    });

    a.dispose();
  });

  describe('shared tabSync instance', () => {
    it('routes messages to each atom by scoped key on a custom channel', async () => {
      const shared = tabSync('app-sync');
      const scope = createScope('app');
      const userDriver = memoryDriver();
      const themeDriver = memoryDriver();

      const a = atom<string>(
        'user',
        withDriver(userDriver),
        withScope(scope),
        withMiddleware(shared),
      );
      const b = atom<string>(
        'theme',
        withDriver(themeDriver),
        withScope(scope),
        withMiddleware(shared),
      );

      const userChanges = vi.fn();
      const themeChanges = vi.fn();
      a.addEventListener('change', userChanges);
      b.addEventListener('change', themeChanges);

      await userDriver.set('app:user', wrap('u', {}));
      await themeDriver.set('app:theme', wrap('t', {}));

      const userChannel = channelInstances.find((ch) => ch.name === 'app-sync');
      expect(userChannel).toBeDefined();

      injectMessage(userChannel!, { type: 'set', key: 'app:user' });
      await whenRefreshed(() => expect(userChanges).toHaveBeenCalledOnce());
      expect(themeChanges).not.toHaveBeenCalled();

      injectMessage(userChannel!, { type: 'set', key: 'app:theme' });
      await whenRefreshed(() => expect(themeChanges).toHaveBeenCalledOnce());

      injectMessage(userChannel!, { type: 'set', key: 'other:theme' });
      await settleRefresh();
      expect(themeChanges).toHaveBeenCalledOnce();

      a.dispose();
      b.dispose();
    });

    it('refreshes all atoms sharing the same scoped key', async () => {
      const shared = tabSync('dup-sync');
      const scope = createScope('session');
      const driver = memoryDriver();

      const a1 = atom<string>(
        'token',
        withDriver(driver),
        withScope(scope),
        withMiddleware(shared),
      );
      const a2 = atom<string>(
        'token',
        withDriver(driver),
        withScope(scope),
        withMiddleware(shared),
      );

      const d1 = vi.fn();
      const d2 = vi.fn();
      a1.addEventListener('delete', d1);
      a2.addEventListener('delete', d2);

      const channel = channelInstances.find((ch) => ch.name === 'dup-sync');
      injectMessage(channel!, { type: 'del', key: 'session:token' });
      await whenRefreshed(() => {
        expect(d1).toHaveBeenCalledOnce();
        expect(d2).toHaveBeenCalledOnce();
      });

      a1.dispose();
      a2.dispose();
    });

    it('reuses one BroadcastChannel for the shared custom channel id', async () => {
      const shared = tabSync('shared-channel');
      const a = atom<string>('a', withDriver(memoryDriver()), withMiddleware(shared));
      const b = atom<string>('b', withDriver(memoryDriver()), withMiddleware(shared));

      const sharedChannels = channelInstances.filter((ch) => ch.name === 'shared-channel');
      expect(sharedChannels).toHaveLength(1);

      a.dispose();
      expect(closedChannels).toEqual([]);

      b.dispose();
      expect(closedChannels).toEqual(['shared-channel']);
    });

    it('uses per-atom default channels when no custom channel is provided', async () => {
      const shared = tabSync();
      const a = atom<string>('alpha', withDriver(memoryDriver()), withMiddleware(shared));
      const b = atom<string>('beta', withDriver(memoryDriver()), withMiddleware(shared));

      await a.set('a');
      await b.set('b');

      expect(messages).toEqual([
        { channel: 'atorage:alpha', data: { type: 'set', key: 'alpha' } },
        { channel: 'atorage:beta', data: { type: 'set', key: 'beta' } },
      ]);

      a.dispose();
      b.dispose();
    });
  });

  describe('separate tabSync instances', () => {
    it('reuses BroadcastChannel when custom channel id matches', async () => {
      const a = atom<string>('k', withDriver(memoryDriver()), withMiddleware(tabSync('global')));
      const b = atom<string>('k2', withDriver(memoryDriver()), withMiddleware(tabSync('global')));

      const globalChannels = channelInstances.filter((ch) => ch.name === 'global');
      expect(globalChannels).toHaveLength(1);

      a.dispose();
      expect(closedChannels).toEqual([]);

      b.dispose();
      expect(closedChannels).toEqual(['global']);
    });

    it('refreshes remaining subscribers when dispose runs during refresh event', async () => {
      const shared = tabSync('dispose-during-route');
      const driver = memoryDriver();
      await driver.set('route-key', wrap('v', {}));

      const a1 = atom<string>('route-key', withDriver(driver), withMiddleware(shared));
      const a2 = atom<string>('route-key', withDriver(driver), withMiddleware(shared));

      let disposedDuringRoute = false;
      const changes: string[] = [];
      a1.addEventListener('change', () => {
        changes.push('a1');
        if (!disposedDuringRoute) {
          disposedDuringRoute = true;
          a2.dispose();
        }
      });
      a2.addEventListener('change', () => {
        changes.push('a2');
      });

      const channel = channelInstances.find((ch) => ch.name === 'dispose-during-route');
      injectMessage(channel!, { type: 'set', key: 'route-key' });
      await whenRefreshed(() => expect(changes).toContain('a1'));

      a1.dispose();
    });

    it('reuses default channel id across separate tabSync instances', async () => {
      const driver = memoryDriver();
      await driver.set('same-key', wrap('x', {}));
      const a = atom<string>('same-key', withDriver(driver), withMiddleware(tabSync()));
      const b = atom<string>('same-key', withDriver(driver), withMiddleware(tabSync()));

      const channels = channelInstances.filter((ch) => ch.name === 'atorage:same-key');
      expect(channels).toHaveLength(1);

      const c1 = vi.fn();
      const c2 = vi.fn();
      a.addEventListener('change', c1);
      b.addEventListener('change', c2);

      injectMessage(channels[0]!, { type: 'set', key: 'same-key' });
      await whenRefreshed(() => {
        expect(c1).toHaveBeenCalledOnce();
        expect(c2).toHaveBeenCalledOnce();
      });

      a.dispose();
      expect(closedChannels).toEqual([]);

      b.dispose();
      expect(closedChannels).toEqual(['atorage:same-key']);
    });
  });

  describe('cross-tab delivery', () => {
    it('delivers peer tab messages only to the matching atom key', async () => {
      const shared = tabSync('peer-sync');
      const driver = memoryDriver();
      await driver.set('settings', wrap('s', {}));

      const local = atom<string>('settings', withDriver(driver), withMiddleware(shared));
      const onChange = vi.fn();
      local.addEventListener('change', onChange);

      const peer = new MockBroadcastChannel('peer-sync');

      const localChannel = channelInstances.find((ch) => ch.name === 'peer-sync' && ch !== peer)!;
      injectMessage(localChannel, { type: 'set', key: 'settings' });
      await whenRefreshed(() => expect(onChange).toHaveBeenCalledOnce());

      onChange.mockClear();
      injectMessage(localChannel, { type: 'set', key: 'other-key' });
      await settleRefresh();
      expect(onChange).not.toHaveBeenCalled();

      local.dispose();
      peer.close();
    });
  });
});
