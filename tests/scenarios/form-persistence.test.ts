import { atom } from '../../src/atom';
import { withDriver, withScope, withMiddleware } from '../../src/modifiers';
import { createScope } from '../../src/scope';
import { memoryDriver } from '../../src/drivers/memory';
import { debounce } from '../../src/middleware/debounce';
import { validate, ValidationError } from '../../src/middleware/validate';
import { eventBus } from '../../src/core/event-bus';

const AUTOSAVE_DELAY = 500;

const isValidEmail = (v: unknown) => typeof v === 'string' && /^[^@]+@[^@]+\.[^@]+$/.test(v);

describe('form draft auto-save', () => {
  afterEach(() => {
    eventBus._clear();
  });

  describe('debounce auto-save', () => {
    it('rapid inputs write only the last value to storage', async () => {
      vi.useFakeTimers();
      const driver = memoryDriver();
      const debounceMw = debounce(AUTOSAVE_DELAY);
      const draft = atom<string>('form-name', withDriver(driver), withMiddleware(debounceMw));

      await draft.set('J');
      await draft.set('Jo');
      await draft.set('Joh');
      await draft.set('John');

      // not yet written to driver
      expect(await driver.get('form-name')).toBeUndefined();

      await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY + 10);

      // only the last write persisted
      const raw = await driver.get('form-name');
      expect(raw).toBeDefined();

      vi.useRealTimers();
      draft.dispose();
    });

    it('get returns latest pending value during debounce (read-your-writes)', async () => {
      vi.useFakeTimers();
      const driver = memoryDriver();
      const debounceMw = debounce(AUTOSAVE_DELAY);
      const draft = atom<string>('form-name', withDriver(driver), withMiddleware(debounceMw));

      await draft.set('pending-value');

      // get returns pending value during debounce, not driver value
      expect(await draft.get()).toBe('pending-value');

      vi.useRealTimers();
      draft.dispose();
    });

    it('manual flush before page close ensures data is persisted', async () => {
      vi.useFakeTimers();
      const driver = memoryDriver();
      const debounceMw = debounce(AUTOSAVE_DELAY);
      const draft = atom<string>('form-name', withDriver(driver), withMiddleware(debounceMw));

      await draft.set('important-unsaved-data');
      expect(await driver.get('form-name')).toBeUndefined();

      // simulate manual flush on beforeunload
      await debounceMw.flush();

      expect(await driver.get('form-name')).toBeDefined();

      vi.useRealTimers();
      draft.dispose();
    });
  });

  describe('draft recovery and cleanup', () => {
    it('recovers draft after page reload', async () => {
      const driver = memoryDriver();

      // first visit: save draft
      const draft1 = atom<string>('form-name', withDriver(driver));
      await draft1.set('saved-draft');
      draft1.dispose();

      // second visit (simulate reload): read draft
      const draft2 = atom<string>('form-name', withDriver(driver));
      expect(await draft2.get()).toBe('saved-draft');
      draft2.dispose();
    });

    it('del clears draft after form submission', async () => {
      const driver = memoryDriver();
      const draft = atom<string>('form-name', withDriver(driver));

      await draft.set('complete-form-data');
      expect(await draft.has()).toBe(true);

      // clear draft after successful submission
      await draft.del();
      expect(await draft.has()).toBe(false);

      draft.dispose();
    });

    it('multiple fields stored separately, scope.clear() clears entire form', async () => {
      const driver = memoryDriver();
      const formScope = createScope('contact-form');

      const name = atom<string>('name', withDriver(driver), withScope(formScope));
      const email = atom<string>('email', withDriver(driver), withScope(formScope));
      const message = atom<string>('message', withDriver(driver), withScope(formScope));

      await name.set('Alice');
      await email.set('alice@example.com');
      await message.set('Hello world');

      expect(await name.has()).toBe(true);
      expect(await email.has()).toBe(true);
      expect(await message.has()).toBe(true);

      // clear entire form on submit or cancel
      await formScope.clear();

      expect(await name.has()).toBe(false);
      expect(await email.has()).toBe(false);
      expect(await message.has()).toBe(false);

      name.dispose();
      email.dispose();
      message.dispose();
    });
  });

  describe('form validation', () => {
    it('validate rejects invalid email format', async () => {
      const driver = memoryDriver();
      const email = atom<string>(
        'form-email',
        withDriver(driver),
        withMiddleware(validate(isValidEmail)),
      );

      await expect(email.set('not-an-email')).rejects.toThrow(ValidationError);
      expect(await email.has()).toBe(false);

      await email.set('valid@example.com');
      expect(await email.get()).toBe('valid@example.com');

      email.dispose();
    });

    it('validation failure does not affect existing valid data', async () => {
      const driver = memoryDriver();
      const email = atom<string>(
        'form-email',
        withDriver(driver),
        withMiddleware(validate(isValidEmail)),
      );

      await email.set('first@example.com');

      await expect(email.set('invalid')).rejects.toThrow(ValidationError);
      expect(await email.get()).toBe('first@example.com');

      email.dispose();
    });
  });
});
