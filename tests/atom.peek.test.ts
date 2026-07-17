import { atom } from '../src/atom';
import { withDriver, withMiddleware } from '../src/modifiers';
import { memoryDriver } from '../src/drivers/memory';
import { AtomDisposedError } from '../src/errors';
import { validate, ValidationError } from '../src/middleware/validate';
import { encrypt } from '../src/middleware/encrypt';
import { debounce } from '../src/middleware/debounce';
import { sync } from '../src/middleware/sync';

const simpleEncryptor = {
  encrypt: (data: string) => data.split('').reverse().join(''),
  decrypt: (data: string) => data.split('').reverse().join(''),
};

describe('atom.peek()', () => {
  it('returns undefined before any successful observation', () => {
    const a = atom<string>('peek-key', withDriver(memoryDriver()));
    expect(a.peek()).toBeUndefined();
    a.dispose();
  });

  it('updates from set input, get result, and clears on del', async () => {
    const driver = memoryDriver();
    const a = atom<string>('peek-key', withDriver(driver));

    await a.set('hello');
    expect(a.peek()).toBe('hello');

    await driver.set(a.key, { $v: 'from-disk' });
    await expect(a.get()).resolves.toBe('from-disk');
    expect(a.peek()).toBe('from-disk');

    await a.del();
    expect(a.peek()).toBeUndefined();

    a.dispose();
  });

  it('failed set does not clobber prior peek', async () => {
    const a = atom<string>(
      'peek-key',
      withDriver(memoryDriver()),
      withMiddleware(validate((v): v is string => typeof v === 'string')),
    );

    await a.set('ok');
    expect(a.peek()).toBe('ok');

    await expect(a.set(1 as unknown as string)).rejects.toThrow(ValidationError);
    expect(a.peek()).toBe('ok');

    a.dispose();
  });

  it('throws AtomDisposedError after dispose', () => {
    const a = atom<string>('peek-key', withDriver(memoryDriver()));
    a.dispose();
    expect(() => a.peek()).toThrow(AtomDisposedError);
  });

  it('repeated get always hits the driver (no transparent cache)', async () => {
    const base = memoryDriver();
    let gets = 0;
    const driver = {
      ...base,
      get: async (key: string) => {
        gets++;
        return base.get(key);
      },
    };
    const a = atom<string>('peek-key', withDriver(driver));
    await a.set('v');
    gets = 0;
    await a.get();
    await a.get();
    expect(gets).toBe(2);
    expect(a.peek()).toBe('v');
    a.dispose();
  });
});

describe('atom.peek() middleware edges', () => {
  it('stays plaintext when encrypt is in the stack', async () => {
    const a = atom<string>(
      'peek-enc',
      withDriver(memoryDriver()),
      withMiddleware(encrypt(simpleEncryptor)),
    );
    await a.set('secret');
    expect(a.peek()).toBe('secret');
    await expect(a.get()).resolves.toBe('secret');
    expect(a.peek()).toBe('secret');
    a.dispose();
  });

  it('updates on debounced set before flush', async () => {
    vi.useFakeTimers();
    const deb = debounce(500);
    const driver = memoryDriver();
    const a = atom<string>('peek-deb', withDriver(driver), withMiddleware(deb));

    await a.set('pending');
    expect(a.peek()).toBe('pending');
    expect(await driver.get(a.key)).toBeUndefined();

    await vi.advanceTimersByTimeAsync(510);
    expect(await driver.get(a.key)).toBeDefined();

    a.dispose();
    vi.useRealTimers();
  });

  it('sync peer refresh updates peer peek without sharing last-known', async () => {
    const driver = memoryDriver();
    const a = atom<string>('peek-sync', withDriver(driver), withMiddleware(sync()));
    const b = atom<string>('peek-sync', withDriver(driver), withMiddleware(sync()));

    await a.set('from-a');
    expect(a.peek()).toBe('from-a');
    expect(b.peek()).toBe('from-a');

    await a.set('again');
    expect(a.peek()).toBe('again');
    expect(b.peek()).toBe('again');

    a.dispose();
    b.dispose();
  });
});
