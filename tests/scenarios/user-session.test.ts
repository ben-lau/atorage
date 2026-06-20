import { atom } from '../../src/atom';
import { defineAtom } from '../../src/define-atom';
import { withDriver, withScope, withMiddleware } from '../../src/modifiers';
import { createScope } from '../../src/scope';
import { memoryDriver } from '../../src/drivers/memory';
import { ttl } from '../../src/middleware/ttl';
import { validate, ValidationError } from '../../src/middleware/validate';
import { cached } from '../../src/middleware/cached';
import { eventBus } from '../../src/core/event-bus';

interface UserProfile {
  id: string;
  name: string;
  email: string;
}

const SESSION_TTL = 30 * 60 * 1000; // 30 minutes
const isValidToken = (v: unknown) => typeof v === 'string' && v.length > 10;

describe('user session management', () => {
  afterEach(() => {
    eventBus._clear();
  });

  describe('login and token storage', () => {
    it('stores token after login and reads within TTL', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(0);

      const driver = memoryDriver();
      const token = atom<string>(
        'auth-token',
        withDriver(driver),
        withMiddleware(validate(isValidToken), ttl(SESSION_TTL)),
      );

      await token.set('eyJhbGciOiJIUzI1NiJ9.valid-token');
      expect(await token.get()).toBe('eyJhbGciOiJIUzI1NiJ9.valid-token');
      expect(await token.has()).toBe(true);

      vi.useRealTimers();
      token.dispose();
    });

    it('returns undefined and has() false after token expires', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(0);

      const driver = memoryDriver();
      const token = atom<string>(
        'auth-token',
        withDriver(driver),
        withMiddleware(validate(isValidToken), ttl(SESSION_TTL)),
      );

      await token.set('eyJhbGciOiJIUzI1NiJ9.valid-token');

      vi.advanceTimersByTime(SESSION_TTL + 1);

      expect(await token.get()).toBeUndefined();
      expect(await token.has()).toBe(false);

      vi.useRealTimers();
      token.dispose();
    });

    it('rejects invalid token format without affecting existing valid token', async () => {
      const driver = memoryDriver();
      const token = atom<string>(
        'auth-token',
        withDriver(driver),
        withMiddleware(validate(isValidToken), ttl(SESSION_TTL)),
      );

      await token.set('eyJhbGciOiJIUzI1NiJ9.valid-token');

      await expect(token.set('short')).rejects.toThrow(ValidationError);
      expect(await token.get()).toBe('eyJhbGciOiJIUzI1NiJ9.valid-token');

      token.dispose();
    });
  });

  describe('logout and scope cleanup', () => {
    it('scope.clear() removes all session data on logout', async () => {
      const driver = memoryDriver();
      const sessionScope = createScope('session');

      const token = atom<string>('token', withDriver(driver), withScope(sessionScope));
      const profile = atom<UserProfile>('profile', withDriver(driver), withScope(sessionScope));
      const prefs = atom<{ theme: string }>('prefs', withDriver(driver), withScope(sessionScope));

      await token.set('eyJhbGciOiJIUzI1NiJ9.valid-token');
      await profile.set({ id: '1', name: 'Alice', email: 'alice@example.com' });
      await prefs.set({ theme: 'dark' });

      expect(await token.has()).toBe(true);
      expect(await profile.has()).toBe(true);
      expect(await prefs.has()).toBe(true);

      await sessionScope.clear();

      expect(await token.has()).toBe(false);
      expect(await profile.has()).toBe(false);
      expect(await prefs.has()).toBe(false);

      token.dispose();
      profile.dispose();
      prefs.dispose();
    });

    it('scope.clear() does not affect disposed atoms', async () => {
      const driver = memoryDriver();
      const sessionScope = createScope('session');

      const token = atom<string>('token', withDriver(driver), withScope(sessionScope));
      const profile = atom<string>('profile', withDriver(driver), withScope(sessionScope));

      await token.set('my-token-value-long');
      await profile.set('alice-profile-data');

      token.dispose();

      await sessionScope.clear();

      // token disposed, scope.clear will not delete its data
      expect(await driver.get('session:token')).toBeDefined();
      // profile not disposed, cleared normally
      expect(await profile.has()).toBe(false);

      profile.dispose();
    });
  });

  describe('session management with defineAtom factory', () => {
    it('factory-created atoms share scope but remain independent', async () => {
      const driver = memoryDriver();
      const sessionScope = createScope('session');

      const createSessionAtom = defineAtom(() => [
        withDriver(driver),
        withScope(sessionScope),
        withMiddleware(cached()),
      ]);

      const token = createSessionAtom<string>('token');
      const profile = createSessionAtom<UserProfile>('profile');

      await token.set('eyJhbGciOiJIUzI1NiJ9.factory-token');
      await profile.set({ id: '2', name: 'Bob', email: 'bob@example.com' });

      expect(token.key).toBe('session:token');
      expect(profile.key).toBe('session:profile');

      expect(await token.get()).toBe('eyJhbGciOiJIUzI1NiJ9.factory-token');
      expect(await profile.get()).toEqual({ id: '2', name: 'Bob', email: 'bob@example.com' });

      await sessionScope.clear();

      expect(await token.has()).toBe(false);
      expect(await profile.has()).toBe(false);

      token.dispose();
      profile.dispose();
    });

    it('full login → use → logout flow', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(0);

      const driver = memoryDriver();
      const sessionScope = createScope('session');

      const createSessionAtom = defineAtom(() => [
        withDriver(driver),
        withScope(sessionScope),
        withMiddleware(ttl(SESSION_TTL), cached()),
      ]);

      // Step 1: login
      const token = createSessionAtom<string>('token');
      const profile = createSessionAtom<UserProfile>('profile');

      await token.set('eyJhbGciOiJIUzI1NiJ9.session-token');
      await profile.set({ id: '3', name: 'Charlie', email: 'charlie@test.com' });

      // Step 2: in use (10 minutes later)
      vi.advanceTimersByTime(10 * 60 * 1000);
      expect(await token.get()).toBe('eyJhbGciOiJIUzI1NiJ9.session-token');
      expect(await profile.get()).toEqual({ id: '3', name: 'Charlie', email: 'charlie@test.com' });

      // Step 3: logout
      await sessionScope.clear();
      expect(await token.has()).toBe(false);
      expect(await profile.has()).toBe(false);

      // Step 4: cleanup
      token.dispose();
      profile.dispose();

      vi.useRealTimers();
    });
  });
});
