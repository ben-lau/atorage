import { atom } from '../../src/atom';
import { withDriver, withMiddleware } from '../../src/modifiers';
import { memoryDriver } from '../../src/drivers/memory';
import { encrypt } from '../../src/middleware/encrypt';

const simpleEncryptor = {
  encrypt: (data: string) => data.split('').reverse().join(''),
  decrypt: (data: string) => data.split('').reverse().join(''),
};

describe('encrypt middleware', () => {
  it('set encrypts the value, get decrypts it (round-trip)', async () => {
    const driver = memoryDriver();
    const a = atom<string>(
      'encrypt-key',
      withDriver(driver),
      withMiddleware(encrypt(simpleEncryptor)),
    );

    await a.set('hello');
    const stored = (await driver.get(a.key)) as { $v: string };
    expect(stored.$v).toBe(simpleEncryptor.encrypt(JSON.stringify('hello')));
    expect(stored.$v).not.toBe('hello');

    await expect(a.get()).resolves.toBe('hello');

    a.dispose();
  });

  it('complex objects round-trip correctly', async () => {
    const a = atom<{ name: string; items: number[]; nested: { ok: boolean } }>(
      'encrypt-complex',
      withDriver(memoryDriver()),
      withMiddleware(encrypt(simpleEncryptor)),
    );

    const value = { name: 'test', items: [1, 2, 3], nested: { ok: true } };
    await a.set(value);
    await expect(a.get()).resolves.toEqual(value);

    a.dispose();
  });

  it('get returns undefined for non-existent keys (no decryption attempted)', async () => {
    const decrypt = vi.fn(simpleEncryptor.decrypt);
    const a = atom<string>(
      'encrypt-missing',
      withDriver(memoryDriver()),
      withMiddleware(encrypt({ ...simpleEncryptor, decrypt })),
    );

    await expect(a.get()).resolves.toBeUndefined();
    expect(decrypt).not.toHaveBeenCalled();

    a.dispose();
  });

  it('del passes through', async () => {
    const a = atom<string>(
      'encrypt-del',
      withDriver(memoryDriver()),
      withMiddleware(encrypt(simpleEncryptor)),
    );

    await a.set('to-delete');
    await expect(a.has()).resolves.toBe(true);
    await a.del();
    await expect(a.has()).resolves.toBe(false);
    await expect(a.get()).resolves.toBeUndefined();

    a.dispose();
  });

  it('async encrypt/decrypt functions work', async () => {
    const asyncEncryptor = {
      encrypt: async (data: string) => data.split('').reverse().join(''),
      decrypt: async (data: string) => data.split('').reverse().join(''),
    };

    const a = atom<number>(
      'encrypt-async',
      withDriver(memoryDriver()),
      withMiddleware(encrypt(asyncEncryptor)),
    );

    await a.set(42);
    await expect(a.get()).resolves.toBe(42);

    a.dispose();
  });

  it('does not decrypt pre-existing string data without enc marker', async () => {
    const driver = memoryDriver();
    await driver.set('key', { $v: 'plain text value' });

    const a = atom('key', withDriver(driver), withMiddleware(encrypt(simpleEncryptor)));

    const val = await a.get();
    expect(val).toBe('plain text value');

    a.dispose();
  });

  it('stores enc marker in meta', async () => {
    const driver = memoryDriver();
    const a = atom('key', withDriver(driver), withMiddleware(encrypt(simpleEncryptor)));

    await a.set({ secret: 'data' });
    const meta = await a.getMeta();
    expect(meta?.enc).toBe(1);

    a.dispose();
  });

  it('corrupt data: decrypt returns invalid JSON → value is undefined, error event fires', async () => {
    const driver = memoryDriver();
    const badEncryptor = {
      encrypt: simpleEncryptor.encrypt,
      decrypt: () => '<<<not json>>>',
    };
    const a = atom('corrupt-key', withDriver(driver), withMiddleware(encrypt(badEncryptor)));

    await driver.set('corrupt-key', { $v: 'garbage', $m: { enc: 1 } });

    const errors: Error[] = [];
    a.addEventListener('error', ((e: CustomEvent) =>
      errors.push(e.detail.error)) as unknown as EventListener);

    const val = await a.get();
    expect(val).toBeUndefined();
    expect(errors.length).toBe(1);

    a.dispose();
  });

  it('corrupt data: decrypt throws → value is undefined, error event fires', async () => {
    const driver = memoryDriver();
    const throwingEncryptor = {
      encrypt: simpleEncryptor.encrypt,
      decrypt: () => {
        throw new Error('decrypt boom');
      },
    };
    const a = atom('corrupt-throw', withDriver(driver), withMiddleware(encrypt(throwingEncryptor)));

    await driver.set('corrupt-throw', { $v: 'bad', $m: { enc: 1 } });

    const errors: Error[] = [];
    a.addEventListener('error', ((e: CustomEvent) =>
      errors.push(e.detail.error)) as unknown as EventListener);

    const val = await a.get();
    expect(val).toBeUndefined();
    expect(errors.length).toBe(1);
    expect(errors[0].message).toBe('decrypt boom');

    a.dispose();
  });
});
