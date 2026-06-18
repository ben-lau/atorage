// @vitest-environment happy-dom
import { tabSync } from '../../src/middleware/tab-sync';
import { atom } from '../../src/atom';
import { withDriver, withMiddleware } from '../../src/modifiers';
import { memoryDriver } from '../../src/drivers/memory';
import { eventBus } from '../../src/core/event-bus';

const messages: { channel: string; data: unknown }[] = [];
const closedChannels: string[] = [];
const channelInstances: MockBroadcastChannel[] = [];

class MockBroadcastChannel {
  name: string;
  closed = false;
  onmessage: ((event: MessageEvent) => void) | null = null;

  constructor(name: string) {
    this.name = name;
    channelInstances.push(this);
  }

  postMessage(msg: unknown) {
    if (!this.closed) {
      messages.push({ channel: this.name, data: msg });
    }
  }

  close() {
    this.closed = true;
    closedChannels.push(this.name);
  }
}

describe('tabSync middleware', () => {
  beforeEach(() => {
    messages.length = 0;
    closedChannels.length = 0;
    channelInstances.length = 0;
    globalThis.BroadcastChannel = MockBroadcastChannel as typeof BroadcastChannel;
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

  it('dispose closes the channel', async () => {
    const { atom: a, mw } = createAtom('dispose-key');

    await a.set('hello');
    expect(closedChannels).toEqual([]);

    mw.onDispose!();

    expect(closedChannels).toEqual(['atorage:dispose-key']);

    // bc is nullified — second dispose must not close again
    mw.onDispose!();
    expect(closedChannels).toEqual(['atorage:dispose-key']);

    a.dispose();
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
      { type: 'delete' },
    );

    channel.onmessage!({ data: { type: 'set', key: 'test-key' } } as MessageEvent);
    expect(notifySpy).toHaveBeenCalledWith(
      'test-key',
      expect.stringMatching(/^__cross_tab_.*__$/),
      { type: 'change' },
    );

    notifySpy.mockRestore();
    a.dispose();
  });
});
