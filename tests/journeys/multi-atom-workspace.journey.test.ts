import { atom } from '../../src/atom';
import { batch } from '../../src/batch';
import { defineAtom } from '../../src/define-atom';
import { withDriver, withMiddleware, withScope } from '../../src/modifiers';
import { createScope } from '../../src/scope';
import { memoryDriver } from '../../src/drivers/memory';
import { cached } from '../../src/middleware/cached';
import { AtomDisposedError } from '../../src/errors';
import { snapshot, restore, clearByPrefix } from '../../src/utils/index';
import { inspect } from '../../src/debug/inspect';
import { ttl } from '../../src/middleware/ttl';

describe('journey: small-app workspace (scopes, batch, utils)', () => {
  it('session + prefs scopes, batch updates, dispose, snapshot migrate', async () => {
    const driver = memoryDriver();
    const session = createScope('session');
    const prefs = createScope('prefs');

    const createSession = defineAtom(() => [
      withDriver(driver),
      withScope(session),
      withMiddleware(cached()),
    ]);

    const token = createSession<string>('token');
    const profile = createSession<{ name: string }>('profile');
    const theme = atom<string>('theme', withDriver(driver), withScope(prefs));
    const counter = atom<number>('counter', withDriver(driver));

    await token.set('tok-1234567890');
    await profile.set({ name: 'Ada' });
    await theme.set('dark');

    const events: string[] = [];
    counter.addEventListener('change', (e) => {
      events.push(String((e as CustomEvent).detail.value));
    });

    await batch(async () => {
      await counter.set(1);
      await counter.update((n) => (n ?? 0) + 1);
      await counter.set(3);
      expect(events).toEqual([]);
    });
    expect(events).toEqual(['3']);
    expect(await counter.get()).toBe(3);

    // clear session only
    await session.clear();
    expect(await token.has()).toBe(false);
    expect(await profile.has()).toBe(false);
    expect(await theme.get()).toBe('dark');

    theme.dispose();
    await expect(theme.get()).rejects.toThrow(AtomDisposedError);

    // snapshot / restore across drivers (workspace migration)
    const source = memoryDriver();
    const target = memoryDriver();
    const a = atom<string>('user:name', withDriver(source));
    const b = atom<number>('user:age', withDriver(source));
    await a.set('Alice');
    await b.set(30);
    a.dispose();
    b.dispose();

    const data = await snapshot({ driver: source, prefix: 'user:' });
    await restore(data, { driver: target });

    const a2 = atom<string>('user:name', withDriver(target));
    const b2 = atom<number>('user:age', withDriver(target));
    expect(await a2.get()).toBe('Alice');
    expect(await b2.get()).toBe(30);
    a2.dispose();
    b2.dispose();

    // clearByPrefix for cache namespace
    const c1 = atom<string>('cache:page1', withDriver(driver));
    const c2 = atom<string>('cache:page2', withDriver(driver));
    const settings = atom<string>('settings:theme', withDriver(driver));
    await c1.set('p1');
    await c2.set('p2');
    await settings.set('dark');
    c1.dispose();
    c2.dispose();
    settings.dispose();

    expect(await clearByPrefix('cache:', { driver })).toBe(2);
    expect(await driver.get('settings:theme')).toBeDefined();

    // inspect for debugging
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const debug = atom<string>('debug-key', withDriver(driver), withMiddleware(ttl(5000)));
    await debug.set('debug-value');
    const info = await inspect(driver, 'debug-key');
    expect(info.exists).toBe(true);
    expect(info.value).toBe('debug-value');
    expect(info.meta.exp).toBe(6000);
    debug.dispose();
    vi.useRealTimers();

    token.dispose();
    profile.dispose();
    counter.dispose();
  });
});
