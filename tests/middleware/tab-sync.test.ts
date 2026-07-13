// @vitest-environment happy-dom
import { tabSync } from '../../src/middleware/tab-sync';
import { atom } from '../../src/atom';
import { withDriver, withMiddleware, withScope } from '../../src/modifiers';
import { memoryDriver } from '../../src/drivers/memory';
import { eventBus } from '../../src/core/event-bus';
import { createScope } from '../../src/scope';

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

  it('maps broadcast message types to eventBus events', async () => {
    const notifySpy = vi.spyOn(eventBus, 'notify');
    const { atom: a } = createAtom('test-key');

    const channel = channelInstances[0];
    expect(channel).toBeDefined();
    expect(channel.onmessage).toBeTypeOf('function');

    channel.onmessage!({ data: { type: 'del', key: 'test-key' } } as MessageEvent);
    expect(notifySpy).toHaveBeenCalledWith(
      'test-key',
      expect.stringMatching(/^__cross_tab_.*__$/),
      [],
      { type: 'delete' },
      { skipDriverCheck: true },
    );

    channel.onmessage!({ data: { type: 'set', key: 'test-key' } } as MessageEvent);
    expect(notifySpy).toHaveBeenCalledWith(
      'test-key',
      expect.stringMatching(/^__cross_tab_.*__$/),
      [],
      { type: 'change' },
      { skipDriverCheck: true },
    );

    notifySpy.mockRestore();
    a.dispose();
  });

  describe('shared tabSync instance', () => {
    it('routes messages to each atom by scoped key on a custom channel', async () => {
      const notifySpy = vi.spyOn(eventBus, 'notify');
      const shared = tabSync('app-sync');
      const scope = createScope('app');

      const a = atom<string>(
        'user',
        withDriver(memoryDriver()),
        withScope(scope),
        withMiddleware(shared),
      );
      const b = atom<string>(
        'theme',
        withDriver(memoryDriver()),
        withScope(scope),
        withMiddleware(shared),
      );

      const userChannel = channelInstances.find((ch) => ch.name === 'app-sync');
      expect(userChannel).toBeDefined();

      userChannel!.onmessage!({
        data: { type: 'set', key: 'app:user' },
      } as MessageEvent);
      expect(notifySpy).toHaveBeenCalledWith(
        'app:user',
        expect.stringMatching(/^__cross_tab_.*__$/),
        [],
        { type: 'change' },
        { skipDriverCheck: true },
      );

      notifySpy.mockClear();

      userChannel!.onmessage!({
        data: { type: 'set', key: 'app:theme' },
      } as MessageEvent);
      expect(notifySpy).toHaveBeenCalledWith(
        'app:theme',
        expect.stringMatching(/^__cross_tab_.*__$/),
        [],
        { type: 'change' },
        { skipDriverCheck: true },
      );

      notifySpy.mockClear();

      userChannel!.onmessage!({
        data: { type: 'set', key: 'other:theme' },
      } as MessageEvent);
      expect(notifySpy).not.toHaveBeenCalled();

      notifySpy.mockRestore();
      a.dispose();
      b.dispose();
    });

    it('notifies all atoms sharing the same scoped key', async () => {
      const notifySpy = vi.spyOn(eventBus, 'notify');
      const shared = tabSync('dup-sync');
      const scope = createScope('session');

      const a1 = atom<string>(
        'token',
        withDriver(memoryDriver()),
        withScope(scope),
        withMiddleware(shared),
      );
      const a2 = atom<string>(
        'token',
        withDriver(memoryDriver()),
        withScope(scope),
        withMiddleware(shared),
      );

      const channel = channelInstances.find((ch) => ch.name === 'dup-sync');
      channel!.onmessage!({
        data: { type: 'del', key: 'session:token' },
      } as MessageEvent);

      const tokenNotifies = notifySpy.mock.calls.filter(([key]) => key === 'session:token');
      expect(tokenNotifies).toHaveLength(2);
      expect(tokenNotifies[0]?.[3]).toEqual({ type: 'delete' });
      expect(tokenNotifies[1]?.[3]).toEqual({ type: 'delete' });

      notifySpy.mockRestore();
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

    it('notifies remaining subscribers when dispose runs during routeMessage', async () => {
      const notifySpy = vi.spyOn(eventBus, 'notify');
      const shared = tabSync('dispose-during-route');
      const a1 = atom<string>('route-key', withDriver(memoryDriver()), withMiddleware(shared));
      const a2 = atom<string>('route-key', withDriver(memoryDriver()), withMiddleware(shared));

      let disposedDuringRoute = false;
      a1.addEventListener('change', () => {
        if (!disposedDuringRoute) {
          disposedDuringRoute = true;
          a2.dispose();
        }
      });

      const channel = channelInstances.find((ch) => ch.name === 'dispose-during-route');
      channel!.onmessage!({
        data: { type: 'set', key: 'route-key' },
      } as MessageEvent);

      expect(notifySpy).toHaveBeenCalledTimes(2);

      notifySpy.mockRestore();
      a1.dispose();
    });

    it('reuses default channel id across separate tabSync instances', async () => {
      const notifySpy = vi.spyOn(eventBus, 'notify');
      const a = atom<string>('same-key', withDriver(memoryDriver()), withMiddleware(tabSync()));
      const b = atom<string>('same-key', withDriver(memoryDriver()), withMiddleware(tabSync()));

      const channels = channelInstances.filter((ch) => ch.name === 'atorage:same-key');
      expect(channels).toHaveLength(1);

      channels[0]!.onmessage!({
        data: { type: 'set', key: 'same-key' },
      } as MessageEvent);

      const sameKeyNotifies = notifySpy.mock.calls.filter(([key]) => key === 'same-key');
      expect(sameKeyNotifies).toHaveLength(2);

      a.dispose();
      expect(closedChannels).toEqual([]);

      b.dispose();
      expect(closedChannels).toEqual(['atorage:same-key']);

      notifySpy.mockRestore();
    });
  });

  describe('cross-tab delivery', () => {
    it('delivers peer tab messages only to the matching atom key', async () => {
      const notifySpy = vi.spyOn(eventBus, 'notify');
      const shared = tabSync('peer-sync');

      const local = atom<string>('settings', withDriver(memoryDriver()), withMiddleware(shared));
      const peer = new MockBroadcastChannel('peer-sync');

      peer.postMessage({ type: 'set', key: 'settings' });

      expect(notifySpy).toHaveBeenCalledWith(
        'settings',
        expect.stringMatching(/^__cross_tab_.*__$/),
        [],
        { type: 'change' },
        { skipDriverCheck: true },
      );

      notifySpy.mockClear();
      peer.postMessage({ type: 'set', key: 'other-key' });
      expect(notifySpy).not.toHaveBeenCalled();

      notifySpy.mockRestore();
      local.dispose();
      peer.close();
    });
  });
});
