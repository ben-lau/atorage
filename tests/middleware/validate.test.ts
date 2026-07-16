import { atom } from '../../src/atom';
import { withDriver, withMiddleware } from '../../src/modifiers';
import { memoryDriver } from '../../src/drivers/memory';
import { validate, ValidationError } from '../../src/middleware/validate';

const isString = (value: unknown): value is string => typeof value === 'string';

describe('validate middleware', () => {
  it('set with valid value succeeds', async () => {
    const driver = memoryDriver();
    const a = atom<string>('key', withDriver(driver), withMiddleware(validate(isString)));

    await a.set('hello');
    await expect(a.get()).resolves.toBe('hello');

    a.dispose();
  });

  it('set with invalid value throws ValidationError', async () => {
    const a = atom<string>('key', withDriver(memoryDriver()), withMiddleware(validate(isString)));

    await expect(a.set(123 as unknown as string)).rejects.toThrow(ValidationError);

    a.dispose();
  });

  it('get with valid stored data returns it', async () => {
    const driver = memoryDriver();
    const a = atom<string>('key', withDriver(driver), withMiddleware(validate(isString)));

    await a.set('stored');
    await expect(a.get()).resolves.toBe('stored');

    a.dispose();
  });

  it('get with invalid stored data returns undefined (not throw)', async () => {
    const driver = memoryDriver();
    const a = atom<string>('key', withDriver(driver), withMiddleware(validate(isString)));

    await driver.set(a.key, { $v: 123 });

    await expect(a.get()).resolves.toBeUndefined();

    a.dispose();
  });

  it('has/del pass through without validation', async () => {
    const driver = memoryDriver();
    const a = atom<string>('key', withDriver(driver), withMiddleware(validate(isString)));

    await driver.set(a.key, { $v: 123 });

    await expect(a.has()).resolves.toBe(true);
    await expect(a.del()).resolves.toBeUndefined();
    await expect(a.has()).resolves.toBe(false);

    a.dispose();
  });
});
