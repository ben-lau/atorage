import { atom } from '../../src/atom';
import { defineAtom } from '../../src/define-atom';
import { withDriver, withMiddleware } from '../../src/modifiers';
import { memoryDriver } from '../../src/drivers/memory';
import { sync } from '../../src/middleware/sync';
import { versioned } from '../../src/middleware/versioned';
import { wrap } from '../../src/core/wrap';

describe('journey: atom independence (default isolated, sync opt-in)', () => {
  it('same key, no sync → peer does not see change events', async () => {
    const driver = memoryDriver();
    const a = atom<string>('token', withDriver(driver));
    const b = atom<string>('token', withDriver(driver));

    const onB = vi.fn();
    b.addEventListener('change', onB);

    await a.set('secret');
    expect(onB).not.toHaveBeenCalled();
    expect(b.peek()).toBeUndefined();
    // Peer can still read via shared driver when it actively gets
    expect(await b.get()).toBe('secret');
    expect(b.peek()).toBe('secret');

    a.dispose();
    b.dispose();
  });

  it('same key + sync → peer receives change via refresh', async () => {
    const driver = memoryDriver();
    const a = atom<string>('token', withDriver(driver), withMiddleware(sync()));
    const b = atom<string>('token', withDriver(driver), withMiddleware(sync()));

    const values: Array<string | undefined> = [];
    b.addEventListener('change', (e) => {
      values.push((e as CustomEvent).detail.value);
    });

    await a.set('v1');
    expect(values).toContain('v1');
    expect(b.peek()).toBe('v1');
    expect(await b.get()).toBe('v1');

    a.dispose();
    b.dispose();
  });

  it('sync peer peek updates to new value (not stuck on prior observation)', async () => {
    const driver = memoryDriver();
    const a = atom<string>('prefs', withDriver(driver), withMiddleware(sync()));
    const b = atom<string>('prefs', withDriver(driver), withMiddleware(sync()));

    await b.set('old');
    expect(b.peek()).toBe('old');

    await a.set('new');
    expect(b.peek()).toBe('new');
    expect(await b.get()).toBe('new');

    a.dispose();
    b.dispose();
  });

  it('migration writeback does not re-broadcast to sync peers', async () => {
    const driver = memoryDriver();
    await driver.set('cfg', wrap({ n: 1 }, { ver: 0 }));

    const a = atom<{ n: number }>(
      'cfg',
      withDriver(driver),
      withMiddleware(
        versioned({
          current: 1,
          migrate: { 0: (d: { n: number }) => ({ n: d.n + 1 }) },
        }),
        sync(),
      ),
    );
    const b = atom<{ n: number }>(
      'cfg',
      withDriver(driver),
      withMiddleware(
        versioned({
          current: 1,
          migrate: { 0: (d: { n: number }) => ({ n: d.n + 1 }) },
        }),
        sync(),
      ),
    );

    const peerChanges = vi.fn();
    b.addEventListener('change', peerChanges);

    // Local get migrates + writebacks; peers must not get a sync storm from writeback
    expect(await a.get()).toEqual({ n: 2 });
    expect(peerChanges).not.toHaveBeenCalled();

    a.dispose();
    b.dispose();
  });

  it('defineAtom factory gives each atom its own peek last-known', async () => {
    const driver = memoryDriver();
    const create = defineAtom(() => [withDriver(driver)]);

    const a = create<string>('a');
    const b = create<string>('b');

    await a.set('alpha');
    await b.set('beta');
    expect(a.peek()).toBe('alpha');
    expect(b.peek()).toBe('beta');
    expect(await a.get()).toBe('alpha');
    expect(await b.get()).toBe('beta');

    a.dispose();
    b.dispose();
  });

  it('disposed peer no longer receives sync notifications', async () => {
    const driver = memoryDriver();
    const a = atom<string>('k', withDriver(driver), withMiddleware(sync()));
    const b = atom<string>('k', withDriver(driver), withMiddleware(sync()));
    const events: string[] = [];

    a.addEventListener('change', () => events.push('a'));
    b.addEventListener('change', () => events.push('b'));

    a.dispose();
    await b.set('x');
    expect(events).toEqual(['b']);

    b.dispose();
  });

  it('sync matches by key only — peer with different driver refreshes its own backend', async () => {
    const d1 = memoryDriver();
    const d2 = memoryDriver();
    const a = atom<string>('same', withDriver(d1), withMiddleware(sync()));
    const b = atom<string>('same', withDriver(d2), withMiddleware(sync()));

    const onDelete = vi.fn();
    b.addEventListener('delete', onDelete);

    await a.set('from-a');
    // Peer refresh reads empty d2 → delete event; a's data stays on d1
    await vi.waitFor(() => expect(onDelete).toHaveBeenCalled());
    expect(await a.get()).toBe('from-a');
    expect(await b.get()).toBeUndefined();

    a.dispose();
    b.dispose();
  });
});
