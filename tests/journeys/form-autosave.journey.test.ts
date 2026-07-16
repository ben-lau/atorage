import { atom } from '../../src/atom';
import { withDriver, withMiddleware, withScope } from '../../src/modifiers';
import { createScope } from '../../src/scope';
import { memoryDriver } from '../../src/drivers/memory';
import { debounce } from '../../src/middleware/debounce';
import { validate, ValidationError } from '../../src/middleware/validate';

const AUTOSAVE_DELAY = 500;
const isValidEmail = (v: unknown) => typeof v === 'string' && /^[^@]+@[^@]+\.[^@]+$/.test(v);

describe('journey: form draft autosave → recover → submit cleanup', () => {
  it('typing, flush, reload, validate, submit clear', async () => {
    vi.useFakeTimers();
    const driver = memoryDriver();
    const formScope = createScope('contact-form');
    const debounceMw = debounce(AUTOSAVE_DELAY);

    const name = atom<string>(
      'name',
      withDriver(driver),
      withScope(formScope),
      withMiddleware(debounceMw),
    );
    const email = atom<string>(
      'email',
      withDriver(driver),
      withScope(formScope),
      withMiddleware(validate(isValidEmail)),
    );

    // rapid typing — only last value persists after debounce
    await name.set('J');
    await name.set('Jo');
    await name.set('John');
    expect(await name.get()).toBe('John');
    expect(await driver.get(name.key)).toBeUndefined();

    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY + 10);
    expect(await driver.get(name.key)).toBeDefined();

    // beforeunload-style flush for a new pending edit
    await name.set('Johnny');
    await debounceMw.flush();
    expect(await driver.get(name.key)).toBeDefined();
    name.dispose();

    // reload recovery
    const name2 = atom<string>('name', withDriver(driver), withScope(formScope));
    expect(await name2.get()).toBe('Johnny');

    // validation keeps previous good email
    await email.set('alice@example.com');
    await expect(email.set('not-an-email')).rejects.toThrow(ValidationError);
    expect(await email.get()).toBe('alice@example.com');

    // submit → clear form scope
    await formScope.clear();
    expect(await name2.has()).toBe(false);
    expect(await email.has()).toBe(false);

    name2.dispose();
    email.dispose();
    vi.useRealTimers();
  });
});
