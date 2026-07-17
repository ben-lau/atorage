import { atom } from '../../src/atom';
import { withDriver, withMiddleware } from '../../src/modifiers';
import { memoryDriver } from '../../src/drivers/memory';
import { debounce } from '../../src/middleware/debounce';
import { sync } from '../../src/middleware/sync';
import { ttl } from '../../src/middleware/ttl';
import { versioned } from '../../src/middleware/versioned';
import { wrap } from '../../src/core/wrap';
import { waitForEvent } from './_helpers';

describe('journey: refresh vs get (user-visible effects)', () => {
  it('TTL expiry on peer refresh clears peer peek without local get', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);

    const driver = memoryDriver();
    const writer = atom<string>(
      'exp',
      withDriver(driver),
      withMiddleware(ttl(1000, { deleteOnExpire: true }), sync()),
    );
    const peer = atom<string>(
      'exp',
      withDriver(driver),
      withMiddleware(ttl(1000, { deleteOnExpire: true }), sync()),
    );

    await writer.set('soon');
    expect(await peer.get()).toBe('soon');
    expect(peer.peek()).toBe('soon');

    vi.setSystemTime(2000);

    // Trigger peer refresh by deleting from writer
    const deleted = waitForEvent(peer, 'delete');
    await writer.del();
    await deleted;
    expect(peer.peek()).toBeUndefined();
    expect(await peer.get()).toBeUndefined();

    writer.dispose();
    peer.dispose();
    vi.useRealTimers();
  });

  it('versioned migrate + writeback: subsequent get skips migrate', async () => {
    const driver = memoryDriver();
    await driver.set('v', wrap({ count: 1 }, { ver: 0 }));

    let migrations = 0;
    const a = atom<{ count: number }>(
      'v',
      withDriver(driver),
      withMiddleware(
        versioned({
          current: 1,
          migrate: {
            0: (d: { count: number }) => {
              migrations++;
              return { count: d.count + 10 };
            },
          },
        }),
        sync(),
      ),
    );

    expect(await a.get()).toEqual({ count: 11 });
    expect(migrations).toBe(1);

    migrations = 0;
    expect(await a.get()).toEqual({ count: 11 });
    expect(migrations).toBe(0);
    expect(await a.getMeta()).toEqual({ ver: 1 });

    a.dispose();
  });

  it('debounce: local get sees pending; peer refresh sees driver truth (pending cleared)', async () => {
    vi.useFakeTimers();
    const driver = memoryDriver();
    const debounceMw = debounce(500);

    const local = atom<string>('draft', withDriver(driver), withMiddleware(debounceMw, sync()));
    const peer = atom<string>('draft', withDriver(driver), withMiddleware(sync()));

    await local.set('pending');
    expect(await local.get()).toBe('pending');
    expect(await driver.get(local.key)).toBeUndefined();

    // Peer refresh (via another set on a third atom) clears debounce pending per debounce contract
    const other = atom<string>('draft', withDriver(driver), withMiddleware(sync()));
    await other.set('from-peer');

    // local's debounce pending was cleared by refresh; driver has peer value
    expect(await local.get()).toBe('from-peer');
    expect(await peer.get()).toBe('from-peer');

    local.dispose();
    peer.dispose();
    other.dispose();
    vi.useRealTimers();
  });
});
