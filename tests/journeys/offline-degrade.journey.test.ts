import { atom } from '../../src/atom';
import { withDriver } from '../../src/modifiers';
import { StorageError } from '../../src/errors';
import type { Driver } from '../../src/types';

function unreliableDriver(
  name: string,
  opts: { failGet?: boolean; failSet?: boolean; failDel?: boolean } = {},
): Driver & { store: Map<string, unknown> } {
  const store = new Map<string, unknown>();
  return {
    name,
    store,
    async get(key) {
      if (opts.failGet) throw new Error(`${name}: get failed`);
      return store.get(key);
    },
    async set(key, value) {
      if (opts.failSet) throw new Error(`${name}: set failed`);
      store.set(key, value);
    },
    async del(key) {
      if (opts.failDel) throw new Error(`${name}: del failed`);
      store.delete(key);
    },
    async has(key) {
      return store.has(key);
    },
    async keys(prefix) {
      return [...store.keys()].filter((k) => !prefix || k.startsWith(prefix));
    },
    async dispose() {
      store.clear();
    },
  };
}

describe('journey: offline / driver degradation as the app experiences it', () => {
  it('primary write fails → data still readable from backup', async () => {
    const primary = unreliableDriver('primary', { failSet: true });
    const backup = unreliableDriver('backup');
    const prefs = atom<string>('prefs', withDriver([primary, backup]));

    await prefs.set('important-data');
    expect(await prefs.get()).toBe('important-data');
    expect(backup.store.has('prefs')).toBe(true);
    expect(primary.store.has('prefs')).toBe(false);

    prefs.dispose();
  });

  it('primary read fails → app still gets backup value', async () => {
    const primary = unreliableDriver('primary', { failGet: true });
    const backup = unreliableDriver('backup');
    backup.store.set('prefs', { $v: 'backup-value' });

    const prefs = atom<string>('prefs', withDriver([primary, backup]));
    expect(await prefs.get()).toBe('backup-value');

    prefs.dispose();
  });

  it('all drivers fail → StorageError surfaces to the caller', async () => {
    const d1 = unreliableDriver('d1', { failSet: true });
    const d2 = unreliableDriver('d2', { failSet: true });
    const prefs = atom<string>('prefs', withDriver([d1, d2]));

    await expect(prefs.set('doomed')).rejects.toThrow(StorageError);

    prefs.dispose();
  });

  it('primary recovers → subsequent writes go back to primary', async () => {
    let primaryFailing = true;
    const primary: Driver & { store: Map<string, unknown> } = {
      name: 'primary',
      store: new Map(),
      async get(key) {
        if (primaryFailing) throw new Error('primary down');
        return this.store.get(key);
      },
      async set(key, value) {
        if (primaryFailing) throw new Error('primary down');
        this.store.set(key, value);
      },
      async del(key) {
        this.store.delete(key);
      },
      async has(key) {
        return this.store.has(key);
      },
      async keys() {
        return [...this.store.keys()];
      },
      async dispose() {
        this.store.clear();
      },
    };
    const backup = unreliableDriver('backup');
    const prefs = atom<string>('prefs', withDriver([primary, backup]));

    await prefs.set('during-outage');
    expect(backup.store.has('prefs')).toBe(true);

    primaryFailing = false;
    await prefs.set('after-recovery');
    expect(primary.store.has('prefs')).toBe(true);
    expect(await prefs.get()).toBe('after-recovery');

    prefs.dispose();
  });
});
