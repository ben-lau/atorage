import { createScope } from '../src/scope';
import { atom } from '../src/atom';
import { withDriver, withScope } from '../src/modifiers';
import { memoryDriver } from '../src/drivers/memory';

describe('createScope', () => {
  it('returns a Scope with the correct name', () => {
    const scope = createScope('auth');
    expect(scope.name).toBe('auth');
  });

  it('clear() deletes registered atoms', async () => {
    const driver = memoryDriver();
    const scope = createScope('session');
    const a = atom<string>('token', withDriver(driver), withScope(scope));

    await a.set('secret');
    const result = await scope.clear();

    expect(result.errors).toEqual([]);
    await expect(a.has()).resolves.toBe(false);
    a.dispose();
  });

  it('two scopes are independent', async () => {
    const driver = memoryDriver();
    const auth = createScope('auth');
    const session = createScope('session');
    const a = atom<string>('k', withDriver(driver), withScope(auth));
    const b = atom<string>('k', withDriver(driver), withScope(session));

    await a.set('a');
    await b.set('b');
    await auth.clear();

    await expect(a.has()).resolves.toBe(false);
    await expect(b.has()).resolves.toBe(true);

    a.dispose();
    b.dispose();
  });

  it('is not an EventTarget', () => {
    const scope = createScope('plain');
    expect('addEventListener' in scope).toBe(false);
  });
});
