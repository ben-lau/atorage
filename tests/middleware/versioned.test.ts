import { atom } from '../../src/atom';
import { withDriver, withMiddleware } from '../../src/modifiers';
import { memoryDriver } from '../../src/drivers/memory';
import { versioned } from '../../src/middleware/versioned';

describe('versioned middleware', () => {
  const CURRENT = 2;

  function createVersionedAtom(key = 'versioned-key') {
    return atom<{ count: number }>(
      key,
      withDriver(memoryDriver()),
      withMiddleware(
        versioned({
          current: CURRENT,
          migrate: {
            0: (data: { count: number }) => ({ count: data.count + 1 }),
            1: (data: { count: number }) => ({ count: data.count * 10 }),
          },
        }),
      ),
    );
  }

  it('set writes ver to meta', async () => {
    const a = createVersionedAtom();
    await a.set({ count: 1 });

    await expect(a.getMeta()).resolves.toEqual({ ver: CURRENT });

    a.dispose();
  });

  it('get with current version: no migration', async () => {
    const driver = memoryDriver();
    const a = atom<{ count: number }>(
      'key',
      withDriver(driver),
      withMiddleware(
        versioned({
          current: CURRENT,
          migrate: {
            0: (data: { count: number }) => ({ count: data.count + 100 }),
          },
        }),
      ),
    );

    await driver.set(a.key, { $v: { count: 5 }, $m: { ver: CURRENT } });

    await expect(a.get()).resolves.toEqual({ count: 5 });

    a.dispose();
  });

  it('get with old version: runs migration chain, requestWriteback is called', async () => {
    const driver = memoryDriver();
    const a = atom<{ count: number }>(
      'key',
      withDriver(driver),
      withMiddleware(
        versioned({
          current: CURRENT,
          migrate: {
            0: (data: { count: number }) => ({ count: data.count + 1 }),
            1: (data: { count: number }) => ({ count: data.count * 10 }),
          },
        }),
      ),
    );

    await driver.set(a.key, { $v: { count: 1 }, $m: { ver: 0 } });

    await expect(a.get()).resolves.toEqual({ count: 20 });
    await expect(a.getMeta()).resolves.toEqual({ ver: CURRENT });

    a.dispose();
  });

  it('get with no ver in meta: treated as v0', async () => {
    const driver = memoryDriver();
    const a = atom<{ count: number }>(
      'key',
      withDriver(driver),
      withMiddleware(
        versioned({
          current: CURRENT,
          migrate: {
            0: (data: { count: number }) => ({ count: data.count + 1 }),
            1: (data: { count: number }) => ({ count: data.count * 10 }),
          },
        }),
      ),
    );

    await driver.set(a.key, { $v: { count: 2 } });

    await expect(a.get()).resolves.toEqual({ count: 30 });

    a.dispose();
  });

  it('migrate functions chain correctly (v0 → v1 → v2)', async () => {
    const driver = memoryDriver();
    const migrate0 = vi.fn((data: { count: number }) => ({ count: data.count + 1 }));
    const migrate1 = vi.fn((data: { count: number }) => ({ count: data.count * 10 }));

    const a = atom<{ count: number }>(
      'key',
      withDriver(driver),
      withMiddleware(
        versioned({
          current: CURRENT,
          migrate: {
            0: migrate0,
            1: migrate1,
          },
        }),
      ),
    );

    await driver.set(a.key, { $v: { count: 3 }, $m: { ver: 0 } });

    await expect(a.get()).resolves.toEqual({ count: 40 });
    expect(migrate0).toHaveBeenCalledOnce();
    expect(migrate0).toHaveBeenCalledWith({ count: 3 });
    expect(migrate1).toHaveBeenCalledOnce();
    expect(migrate1).toHaveBeenCalledWith({ count: 4 });

    a.dispose();
  });

  it('throws when migration step is missing', async () => {
    const driver = memoryDriver();
    await driver.set('key', { $v: { name: 'old' }, $m: { ver: 0 } });

    const a = atom(
      'key',
      withDriver(driver),
      withMiddleware(
        versioned({
          current: 3,
          migrate: { 0: (d) => ({ ...d, a: 1 }), 2: (d) => ({ ...d, c: 3 }) },
        }),
      ),
    );

    await expect(a.get()).rejects.toThrow('Missing migration for version 1 → 2');

    a.dispose();
  });

  it('migrate function throws → error propagates to caller and fires error event', async () => {
    const driver = memoryDriver();
    await driver.set('key', { $v: { count: 1 }, $m: { ver: 0 } });

    const a = atom<{ count: number }>(
      'key',
      withDriver(driver),
      withMiddleware(
        versioned({
          current: 1,
          migrate: {
            0: () => {
              throw new Error('migration exploded');
            },
          },
        }),
      ),
    );

    const errors: Error[] = [];
    a.addEventListener('error', ((e: CustomEvent) =>
      errors.push(e.detail.error)) as unknown as EventListener);

    await expect(a.get()).rejects.toThrow('migration exploded');
    expect(errors.length).toBe(1);
    expect(errors[0].message).toBe('migration exploded');

    a.dispose();
  });
});
