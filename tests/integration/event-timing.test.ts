import { atom } from '../../src/atom';
import { batch } from '../../src/batch';
import { withDriver, withMiddleware } from '../../src/modifiers';
import { memoryDriver } from '../../src/drivers/memory';
import { debounce } from '../../src/middleware/debounce';
import { sync } from '../../src/middleware/sync';
import type { Driver } from '../../src/types';

const DEBOUNCE_MS = 100;

function failingSetDriver(): Driver {
  const base = memoryDriver();
  return {
    ...base,
    set: () => Promise.reject(new Error('set failed')),
  };
}

describe('event timing', () => {
  describe('debounce change events', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('does not fire change events on set until debounce flush', async () => {
      const a = atom<string>(
        'debounce-events-key',
        withDriver(memoryDriver()),
        withMiddleware(debounce(DEBOUNCE_MS)),
      );

      const changes: (string | undefined)[] = [];
      a.addEventListener('change', ((e: CustomEvent) => {
        changes.push(e.detail.value);
      }) as EventListener);

      await a.set('pending');
      expect(changes).toEqual([]);

      await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
      expect(changes).toEqual(['pending']);

      a.dispose();
    });
  });

  describe('batch defers local events', () => {
    it('fires events on both atoms after batch completes when sync is enabled', async () => {
      const key = 'batch-bus-key';
      const driver = memoryDriver();
      const atom1 = atom<string>(key, withDriver(driver), withMiddleware(sync()));
      const atom2 = atom<string>(key, withDriver(driver), withMiddleware(sync()));

      const atom1Events: string[] = [];
      const atom2Events: string[] = [];
      atom1.addEventListener('change', () => atom1Events.push('change'));
      atom2.addEventListener('change', () => atom2Events.push('change'));

      await batch(async () => {
        await atom1.set('updated');
        expect(atom1Events).toEqual([]);
        expect(atom2Events).toEqual([]);
      });

      expect(atom1Events).toEqual(['change']);
      expect(atom2Events).toEqual(['change']);

      atom1.dispose();
      atom2.dispose();
    });

    it('defers events from update() until batch completes', async () => {
      const a = atom<number>('batch-update-key', withDriver(memoryDriver()));
      await a.set(1);

      const events: string[] = [];
      a.addEventListener('change', () => events.push('change'));

      await batch(async () => {
        await a.update((prev) => (prev ?? 0) + 1);
        expect(events).toEqual([]);
      });

      expect(events).toEqual(['change']);
      await expect(a.get()).resolves.toBe(2);

      a.dispose();
    });
  });

  describe('error event on set failure', () => {
    it('throws and dispatches error event when driver set fails', async () => {
      const a = atom<string>('set-fail-key', withDriver(failingSetDriver()));

      const errors: Error[] = [];
      a.addEventListener('error', ((e: CustomEvent) => {
        errors.push(e.detail.error);
      }) as EventListener);

      await expect(a.set('value')).rejects.toThrow('All drivers failed on set');
      expect(errors).toHaveLength(1);
      expect(errors[0].name).toBe('StorageError');

      a.dispose();
    });
  });
});
