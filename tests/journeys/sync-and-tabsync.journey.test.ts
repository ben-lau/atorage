// @vitest-environment happy-dom
import { atom } from '../../src/atom';
import { withDriver, withMiddleware } from '../../src/modifiers';
import { memoryDriver } from '../../src/drivers/memory';
import { compress } from '../../src/middleware/compress';
import { encrypt } from '../../src/middleware/encrypt';
import { sync } from '../../src/middleware/sync';
import { tabSync } from '../../src/middleware/tab-sync';
import { wrap } from '../../src/core/wrap';
import {
  identityCompress,
  injectBroadcastMessage,
  installMockBroadcastChannel,
  resetMockBroadcastChannels,
  simpleEncryptor,
  waitForEvent,
} from './_helpers';

describe('journey: sync + tabSync from the app perspective', () => {
  beforeEach(() => {
    installMockBroadcastChannel();
  });

  afterEach(() => {
    resetMockBroadcastChannels();
  });

  it('same-tab sync + encrypt: peer change event carries plaintext', async () => {
    const driver = memoryDriver();
    const a = atom<string>(
      'secret',
      withDriver(driver),
      withMiddleware(encrypt(simpleEncryptor), sync()),
    );
    const b = atom<string>(
      'secret',
      withDriver(driver),
      withMiddleware(encrypt(simpleEncryptor), sync()),
    );

    const changed = waitForEvent(b, 'change');
    await a.set('hello');
    expect((await changed).detail.value).toBe('hello');
    expect(b.peek()).toBe('hello');
    expect(await b.get()).toBe('hello');

    a.dispose();
    b.dispose();
  });

  it('same-tab sync + compress: peer sees decompressed value', async () => {
    const driver = memoryDriver();
    const a = atom<string>(
      'blob',
      withDriver(driver),
      withMiddleware(compress(identityCompress), sync()),
    );
    const b = atom<string>(
      'blob',
      withDriver(driver),
      withMiddleware(compress(identityCompress), sync()),
    );

    const changed = waitForEvent(b, 'change');
    await a.set('payload');
    expect((await changed).detail.value).toBe('payload');
    expect(b.peek()).toBe('payload');

    a.dispose();
    b.dispose();
  });

  it('cross-tab tabSync: other tab signal refreshes local peek', async () => {
    const driver = memoryDriver();
    const channel = 'app-settings';
    const local = atom<string>('settings', withDriver(driver), withMiddleware(tabSync(channel)));

    await local.set('light');
    expect(local.peek()).toBe('light');
    expect(await local.get()).toBe('light');

    // Other tab wrote through the shared backend and broadcast a signal
    await driver.set(local.key, wrap('dark', {}));
    const changed = waitForEvent(local, 'change');
    injectBroadcastMessage(channel, { type: 'set', key: local.key });
    expect((await changed).detail.value).toBe('dark');
    expect(local.peek()).toBe('dark');
    expect(await local.get()).toBe('dark');

    local.dispose();
  });

  it('custom tabSync channels do not cross-talk', async () => {
    const driver = memoryDriver();
    const a = atom<string>('k', withDriver(driver), withMiddleware(tabSync('chan-a')));
    const b = atom<string>('k', withDriver(driver), withMiddleware(tabSync('chan-b')));

    const onB = vi.fn();
    b.addEventListener('change', onB);

    await a.set('only-a');
    // Signal on chan-a must not refresh chan-b subscribers
    injectBroadcastMessage('chan-a', { type: 'set', key: 'k' });
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    expect(onB).not.toHaveBeenCalled();
    expect(await b.get()).toBe('only-a');

    a.dispose();
    b.dispose();
  });
});
