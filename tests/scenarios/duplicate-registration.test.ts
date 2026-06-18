import { atom } from '../../src/atom';
import { defineAtom } from '../../src/define-atom';
import { withDriver, withScope, withMiddleware } from '../../src/modifiers';
import { createScope } from '../../src/scope';
import { memoryDriver } from '../../src/drivers/memory';
import { cached } from '../../src/middleware/cached';
import { eventBus } from '../../src/core/event-bus';
import type { Driver } from '../../src/types';

describe('Scenario: duplicate registration and multi-instance conflicts', () => {
  afterEach(() => {
    eventBus._clear();
  });

  describe('Multiple atom instances with same key and same driver', () => {
    it('two instances writing to the same key: later write overwrites earlier, but first reads second data', async () => {
      const driver = memoryDriver();
      const a1 = atom<string>('user', withDriver(driver));
      const a2 = atom<string>('user', withDriver(driver));

      await a1.set('alice');
      await a2.set('bob');

      // a1 should now see bob's data since they share the same driver+key
      expect(await a1.get()).toBe('bob');
      expect(await a2.get()).toBe('bob');

      a1.dispose();
      a2.dispose();
    });

    it('after one instance deletes, another instance has() should return false', async () => {
      const driver = memoryDriver();
      const a1 = atom<string>('shared', withDriver(driver));
      const a2 = atom<string>('shared', withDriver(driver));

      await a1.set('data');
      await a2.del();

      expect(await a1.has()).toBe(false);

      a1.dispose();
      a2.dispose();
    });

    it('after one instance disposes, the other instance still works normally', async () => {
      const driver = memoryDriver();
      const a1 = atom<string>('persistent', withDriver(driver));
      const a2 = atom<string>('persistent', withDriver(driver));

      await a1.set('value');
      a1.dispose();

      expect(await a2.get()).toBe('value');
      await a2.set('updated');
      expect(await a2.get()).toBe('updated');

      a2.dispose();
    });

    it('disposed instance no longer receives eventBus notifications', async () => {
      const driver = memoryDriver();
      const a1 = atom<string>('key', withDriver(driver));
      const a2 = atom<string>('key', withDriver(driver));
      const events: string[] = [];

      a1.addEventListener('change', () => events.push('a1-change'));
      a2.addEventListener('change', () => events.push('a2-change'));

      a1.dispose();
      await a2.set('new-value');

      // a1 should NOT receive the event-bus notification
      expect(events).toEqual(['a2-change']);

      a2.dispose();
    });
  });

  describe('Same key but different drivers (no eventBus sync)', () => {
    it('two atoms with same key but different drivers do not affect each other', async () => {
      const driver1 = memoryDriver();
      const driver2 = memoryDriver();
      const a1 = atom<string>('key', withDriver(driver1));
      const a2 = atom<string>('key', withDriver(driver2));

      await a1.set('from-driver1');
      await a2.set('from-driver2');

      expect(await a1.get()).toBe('from-driver1');
      expect(await a2.get()).toBe('from-driver2');

      a1.dispose();
      a2.dispose();
    });

    it('same key but different drivers: eventBus still notifies (architectural issue exposed)', async () => {
      const driver1 = memoryDriver();
      const driver2 = memoryDriver();
      const a1 = atom<string>('samename', withDriver(driver1));
      const a2 = atom<string>('samename', withDriver(driver2));
      const changes: string[] = [];

      a2.addEventListener('change', (e) => {
        changes.push((e as CustomEvent).detail.value);
      });

      await a1.set('hello');

      // eventBus uses key to notify - it doesn't distinguish drivers
      // so a2 gets notified even though its driver has different data
      expect(changes).toContain('hello');

      // but a2.get() reads from its own driver which has nothing
      expect(await a2.get()).toBeUndefined();

      a1.dispose();
      a2.dispose();
    });
  });

  describe('Cross-instance state leak via cached middleware', () => {
    it('shared cached instance causes cross-atom cache pollution', async () => {
      const sharedCache = cached();
      const driver = memoryDriver();
      const a1 = atom<string>('key1', withDriver(driver), withMiddleware(sharedCache));
      const a2 = atom<string>('key2', withDriver(driver), withMiddleware(sharedCache));

      await a1.set('value1');
      await a2.set('value2');

      // If cached() is shared, get from a1 might return a2's cached value
      // because the cache doesn't distinguish by key
      const val1 = await a1.get();
      const val2 = await a2.get();

      // This exposes whether the library protects against shared middleware instances
      // Expected correct behavior: each atom should see its own value
      // If cache is shared without key discrimination, this could fail
      expect(val1).toBe('value1');
      expect(val2).toBe('value2');

      a1.dispose();
      a2.dispose();
    });

    it('independent cached instances per atom do not interfere', async () => {
      const driver = memoryDriver();
      const a1 = atom<string>('key1', withDriver(driver), withMiddleware(cached()));
      const a2 = atom<string>('key2', withDriver(driver), withMiddleware(cached()));

      await a1.set('value1');
      await a2.set('value2');

      expect(await a1.get()).toBe('value1');
      expect(await a2.get()).toBe('value2');

      a1.dispose();
      a2.dispose();
    });
  });

  describe('Pitfalls of shared defineAtom configuration', () => {
    it('shared stateful middleware in defineAtom causes cross-instance interference', async () => {
      const sharedCache = cached();
      const create = defineAtom(withDriver(memoryDriver()), withMiddleware(sharedCache));

      const a1 = create<string>('a');
      const a2 = create<string>('b');

      await a1.set('first');
      await a2.set('second');

      // shared cached() means set('second') overwrites the cache
      // then get on a1 hits the shared cache and gets 'second'
      const resultA = await a1.get();
      const resultB = await a2.get();

      // This test exposes whether defineAtom correctly isolates state
      expect(resultA).toBe('first');
      expect(resultB).toBe('second');

      a1.dispose();
      a2.dispose();
    });

    it('instances from multiple defineAtom calls should be isolated from each other', async () => {
      const driver = memoryDriver();
      const create = defineAtom(withDriver(driver));

      const instances = Array.from({ length: 10 }, (_, i) => create<number>(`counter-${i}`));

      await Promise.all(instances.map((a, i) => a.set(i)));

      for (let i = 0; i < instances.length; i++) {
        expect(await instances[i].get()).toBe(i);
      }

      instances.forEach((a) => a.dispose());
    });
  });

  describe('Scope duplicate registration and cleanup', () => {
    it('same scope registered to multiple atoms: clear() should clear all', async () => {
      const driver = memoryDriver();
      const scope = createScope('session');
      const atoms = Array.from({ length: 5 }, (_, i) =>
        atom<string>(`item-${i}`, withDriver(driver), withScope(scope)),
      );

      await Promise.all(atoms.map((a, i) => a.set(`val-${i}`)));

      const allDeleted = Promise.all(
        atoms.map(
          (a) => new Promise<void>((r) => a.addEventListener('delete', () => r(), { once: true })),
        ),
      );
      scope.clear();
      await allDeleted;

      for (const a of atoms) {
        expect(await a.has()).toBe(false);
      }

      atoms.forEach((a) => a.dispose());
    });

    it('adding same scope to the same atom repeatedly (dedup check)', async () => {
      const driver = memoryDriver();
      const scope = createScope('app');
      const a = atom<string>('key', withDriver(driver), withScope(scope, scope));

      await a.set('value');

      // key prefix should not duplicate: 'app:app:key' vs 'app:key'
      expect(a.key).toBe('app:key');

      const deleted = new Promise<void>((r) =>
        a.addEventListener('delete', () => r(), { once: true }),
      );
      scope.clear();
      await deleted;

      expect(await a.has()).toBe(false);

      a.dispose();
    });

    it('two scopes with the same name are different instances; clear only affects the bound one', async () => {
      const driver = memoryDriver();
      const scope1 = createScope('session');
      const scope2 = createScope('session');
      const a1 = atom<string>('key', withDriver(driver), withScope(scope1));
      const a2 = atom<string>('key2', withDriver(driver), withScope(scope2));

      await a1.set('data1');
      await a2.set('data2');

      const deleted = new Promise<void>((r) =>
        a1.addEventListener('delete', () => r(), { once: true }),
      );
      scope1.clear();
      await deleted;

      // only a1 should be cleared, a2 is on a different scope instance
      expect(await a1.has()).toBe(false);
      expect(await a2.has()).toBe(true);

      a1.dispose();
      a2.dispose();
    });
  });

  describe('Bulk eventBus registration', () => {
    it('creating many same-key atoms then disposing all does not leak memory', async () => {
      const driver = memoryDriver();
      const atoms = Array.from({ length: 100 }, () => atom<string>('hotkey', withDriver(driver)));

      await atoms[0].set('data');

      // All 100 atoms should be notified
      const changeCount = await new Promise<number>((resolve) => {
        let count = 0;
        atoms.slice(1).forEach((a) => {
          a.addEventListener('change', () => count++);
        });
        atoms[0].set('trigger').then(() => resolve(count));
      });
      expect(changeCount).toBe(99);

      atoms.forEach((a) => a.dispose());

      // After all disposed, setting on a new atom should not trigger old listeners
      const fresh = atom<string>('hotkey', withDriver(driver));
      const lateEvents: unknown[] = [];
      fresh.addEventListener('change', (e) => lateEvents.push(e));
      await fresh.set('alone');

      expect(lateEvents.length).toBe(1); // only its own event
      fresh.dispose();
    });
  });
});
