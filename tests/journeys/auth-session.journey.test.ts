import { defineAtom } from '../../src/define-atom';
import { withDriver, withMiddleware, withScope } from '../../src/modifiers';
import { createScope } from '../../src/scope';
import { memoryDriver } from '../../src/drivers/memory';
import { ttl } from '../../src/middleware/ttl';
import { validate, ValidationError } from '../../src/middleware/validate';
import { atom } from '../../src/atom';

interface UserProfile {
  id: string;
  name: string;
  email: string;
}

const SESSION_TTL = 30 * 60 * 1000;
const isValidToken = (v: unknown) => typeof v === 'string' && v.length > 10;

describe('journey: auth session login → use → expire → logout', () => {
  it('full session lifecycle with defineAtom + scope', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);

    const driver = memoryDriver();
    const sessionScope = createScope('session');
    const prefsScope = createScope('prefs');

    const createSessionAtom = defineAtom(() => [
      withDriver(driver),
      withScope(sessionScope),
      withMiddleware(validate(isValidToken), ttl(SESSION_TTL)),
    ]);

    const token = createSessionAtom<string>('token');
    // profile uses a looser validator via plain atom in same scope
    const profile = atom<UserProfile>('profile', withDriver(driver), withScope(sessionScope));
    const theme = atom<string>('theme', withDriver(driver), withScope(prefsScope));

    // login
    await token.set('eyJhbGciOiJIUzI1NiJ9.session-token');
    await profile.set({ id: '3', name: 'Charlie', email: 'charlie@test.com' });
    await theme.set('dark');

    // use (10 minutes later)
    vi.advanceTimersByTime(10 * 60 * 1000);
    expect(await token.get()).toBe('eyJhbGciOiJIUzI1NiJ9.session-token');
    expect(await profile.get()).toEqual({
      id: '3',
      name: 'Charlie',
      email: 'charlie@test.com',
    });

    // invalid token rejected; previous remains
    await expect(token.set('short')).rejects.toThrow(ValidationError);
    expect(await token.get()).toBe('eyJhbGciOiJIUzI1NiJ9.session-token');

    // expire
    vi.advanceTimersByTime(SESSION_TTL);
    expect(await token.get()).toBeUndefined();
    expect(await token.has()).toBe(false);

    // re-login then logout via scope.clear
    await token.set('eyJhbGciOiJIUzI1NiJ9.new-session');
    await sessionScope.clear();
    expect(await token.has()).toBe(false);
    expect(await profile.has()).toBe(false);
    // prefs outside session survive
    expect(await theme.get()).toBe('dark');

    token.dispose();
    profile.dispose();
    theme.dispose();
    vi.useRealTimers();
  });
});
