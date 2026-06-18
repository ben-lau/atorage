import { atom } from '../../src/atom';
import { withDriver, withMiddleware } from '../../src/modifiers';
import { memoryDriver } from '../../src/drivers/memory';
import { validate, ValidationError } from '../../src/middleware/validate';
import { eventBus } from '../../src/core/event-bus';
import type { Driver } from '../../src/types';

const isString = (value: unknown): value is string => typeof value === 'string';

function failingGetDriver(): Driver {
  const base = memoryDriver();
  return {
    ...base,
    get: () => Promise.reject(new Error('get failed')),
  };
}

describe('error events', () => {
  afterEach(() => {
    eventBus._clear();
  });

  it('validate read failure dispatches error event and returns undefined', async () => {
    const driver = memoryDriver();
    const a = atom<string>(
      'validate-read-key',
      withDriver(driver),
      withMiddleware(validate(isString)),
    );

    await driver.set(a.key, { $v: 123 });

    const errors: Error[] = [];
    a.addEventListener('error', ((e: CustomEvent) => {
      errors.push(e.detail.error);
    }) as EventListener);

    await expect(a.get()).resolves.toBeUndefined();
    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(ValidationError);

    a.dispose();
  });

  it('set failure dispatches error event and throws', async () => {
    const a = atom<string>(
      'validate-set-key',
      withDriver(memoryDriver()),
      withMiddleware(validate(isString)),
    );

    const errors: Error[] = [];
    a.addEventListener('error', ((e: CustomEvent) => {
      errors.push(e.detail.error);
    }) as EventListener);

    await expect(a.set(123 as unknown as string)).rejects.toThrow(ValidationError);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(ValidationError);

    a.dispose();
  });

  it('driver failure dispatches error event and throws on get', async () => {
    const a = atom<string>('driver-fail-key', withDriver(failingGetDriver()));

    const errors: Error[] = [];
    a.addEventListener('error', ((e: CustomEvent) => {
      errors.push(e.detail.error);
    }) as EventListener);

    await expect(a.get()).rejects.toThrow('All drivers failed on get');
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toBe('All drivers failed on get');

    a.dispose();
  });
});
