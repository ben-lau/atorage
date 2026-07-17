import { atom } from '../../src/atom';
import { defineAtom } from '../../src/define-atom';
import { withDriver, withMiddleware } from '../../src/modifiers';
import { memoryDriver } from '../../src/drivers/memory';
import { compress } from '../../src/middleware/compress';
import { encrypt } from '../../src/middleware/encrypt';
import { sync } from '../../src/middleware/sync';
import { ttl } from '../../src/middleware/ttl';
import { validate, ValidationError } from '../../src/middleware/validate';
import { versioned } from '../../src/middleware/versioned';
import { wrap } from '../../src/core/wrap';
import { identityCompress, simpleEncryptor, waitForEvent } from './_helpers';

interface Settings {
  theme: string;
  fontSize?: number;
}

const isSettings = (v: unknown): v is Settings =>
  typeof v === 'object' && v !== null && typeof (v as Settings).theme === 'string';

describe('journey: README recommended middleware stack', () => {
  it('full stack: write, peer sync plaintext, reject bad write, expire', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);

    const driver = memoryDriver();
    const stack = () => [
      withDriver(driver),
      withMiddleware(
        validate(isSettings),
        ttl(5_000),
        versioned({
          current: 2,
          migrate: {
            1: (d: Settings) => ({ ...d, fontSize: d.fontSize ?? 14 }),
          },
        }),
        compress(identityCompress),
        encrypt(simpleEncryptor),
        sync(),
      ),
    ];

    const create = defineAtom(stack);
    const a = create<Settings>('settings');
    const b = create<Settings>('settings');

    const peerChanged = waitForEvent(b, 'change');
    await a.set({ theme: 'dark' });
    expect((await peerChanged).detail.value).toEqual({ theme: 'dark' });
    expect(b.peek()).toEqual({ theme: 'dark' });
    expect(await b.get()).toEqual({ theme: 'dark' });
    expect(await a.get()).toEqual({ theme: 'dark' });
    expect(a.peek()).toEqual({ theme: 'dark' });

    const raw = await driver.get(a.key);
    expect(JSON.stringify(raw)).not.toContain('dark');

    await expect(a.set('nope' as unknown as Settings)).rejects.toThrow(ValidationError);
    expect(await a.get()).toEqual({ theme: 'dark' });
    expect(a.peek()).toEqual({ theme: 'dark' });

    vi.advanceTimersByTime(5_001);
    expect(await a.get()).toBeUndefined();
    expect(a.peek()).toBeUndefined();
    expect(await a.has()).toBe(false);

    a.dispose();
    b.dispose();
    vi.useRealTimers();
  });

  it('encrypt under validate: local set/get returns plaintext', async () => {
    const driver = memoryDriver();
    const a = atom<Settings>(
      'settings',
      withDriver(driver),
      withMiddleware(validate(isSettings), encrypt(simpleEncryptor)),
    );

    await a.set({ theme: 'dark' });
    expect(a.peek()).toEqual({ theme: 'dark' });
    expect(await a.get()).toEqual({ theme: 'dark' });
    expect(JSON.stringify(await driver.get(a.key))).not.toContain('dark');

    a.dispose();
  });

  it('sync peer refresh yields plaintext through encrypt+compress', async () => {
    const driver = memoryDriver();
    const mw = [
      validate(isSettings),
      compress(identityCompress),
      encrypt(simpleEncryptor),
      sync(),
    ] as const;

    const a = atom<Settings>('settings', withDriver(driver), withMiddleware(...mw));
    const b = atom<Settings>('settings', withDriver(driver), withMiddleware(...mw));

    const peerChanged = waitForEvent(b, 'change');
    await a.set({ theme: 'dark' });
    expect((await peerChanged).detail.value).toEqual({ theme: 'dark' });
    expect(b.peek()).toEqual({ theme: 'dark' });
    expect(await b.get()).toEqual({ theme: 'dark' });

    a.dispose();
    b.dispose();
  });

  it('legacy v1 disk data migrates; subsequent read skips migrate', async () => {
    const driver = memoryDriver();
    await driver.set('settings', wrap({ theme: 'light' }, { ver: 1 }));

    let migrations = 0;
    const a = atom<Settings>(
      'settings',
      withDriver(driver),
      withMiddleware(
        validate(isSettings),
        versioned({
          current: 2,
          migrate: {
            1: (d: Settings) => {
              migrations++;
              return { ...d, fontSize: 16 };
            },
          },
        }),
        sync(),
      ),
    );

    expect(await a.get()).toEqual({ theme: 'light', fontSize: 16 });
    expect(a.peek()).toEqual({ theme: 'light', fontSize: 16 });
    expect(migrations).toBe(1);
    migrations = 0;
    expect(await a.get()).toEqual({ theme: 'light', fontSize: 16 });
    expect(migrations).toBe(0);
    expect(await a.getMeta()).toEqual({ ver: 2 });

    a.dispose();
  });
});
