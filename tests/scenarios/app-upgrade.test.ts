import { atom } from '../../src/atom';
import { withDriver, withMiddleware } from '../../src/modifiers';
import { memoryDriver } from '../../src/drivers/memory';
import { versioned } from '../../src/middleware/versioned';
import { validate } from '../../src/middleware/validate';
import { cached } from '../../src/middleware/cached';
import { eventBus } from '../../src/core/event-bus';

interface SettingsV1 {
  theme: string;
}

interface SettingsV2 extends SettingsV1 {
  fontSize: number;
}

interface SettingsV3 {
  theme: string;
  fontSize: number;
  language: string;
}

const isValidSettings = (v: unknown): boolean =>
  typeof v === 'object' && v !== null && 'theme' in v && 'fontSize' in v && 'language' in v;

describe('app upgrade data migration', () => {
  afterEach(() => {
    eventBus._clear();
  });

  describe('chained version migration', () => {
    it('v1 data migrated through v1->v2->v3 chain reads correctly', async () => {
      const driver = memoryDriver();

      // simulate v1 data stored by old app version
      await driver.set('settings', { $v: { theme: 'light' }, $m: { ver: 1 } });

      const settings = atom<SettingsV3>(
        'settings',
        withDriver(driver),
        withMiddleware(
          versioned({
            current: 3,
            migrate: {
              1: (d: SettingsV1) => ({ ...d, fontSize: 14 }),
              2: (d: SettingsV2) => ({ ...d, language: 'zh-CN' }),
            },
          }),
        ),
      );

      const result = await settings.get();
      expect(result).toEqual({ theme: 'light', fontSize: 14, language: 'zh-CN' });

      settings.dispose();
    });

    it('auto-writeback after migration, subsequent reads skip migration', async () => {
      const driver = memoryDriver();
      await driver.set('settings', { $v: { theme: 'dark' }, $m: { ver: 1 } });

      let migrateCallCount = 0;
      const settings = atom<SettingsV3>(
        'settings',
        withDriver(driver),
        withMiddleware(
          versioned({
            current: 3,
            migrate: {
              1: (d: SettingsV1) => {
                migrateCallCount++;
                return { ...d, fontSize: 16 };
              },
              2: (d: SettingsV2) => {
                migrateCallCount++;
                return { ...d, language: 'en' };
              },
            },
          }),
        ),
      );

      await settings.get(); // triggers migration + writeback
      expect(migrateCallCount).toBe(2);

      migrateCallCount = 0;
      await settings.get(); // second read should not trigger migration
      expect(migrateCallCount).toBe(0);

      // driver data is now v3
      const raw = (await driver.get('settings')) as { $m: { ver: number } };
      expect(raw.$m.ver).toBe(3);

      settings.dispose();
    });

    it('v2 data only needs v2->v3 single-step migration', async () => {
      const driver = memoryDriver();
      await driver.set('settings', {
        $v: { theme: 'auto', fontSize: 18 },
        $m: { ver: 2 },
      });

      const settings = atom<SettingsV3>(
        'settings',
        withDriver(driver),
        withMiddleware(
          versioned({
            current: 3,
            migrate: {
              1: (d: SettingsV1) => ({ ...d, fontSize: 14 }),
              2: (d: SettingsV2) => ({ ...d, language: 'ja' }),
            },
          }),
        ),
      );

      const result = await settings.get();
      expect(result).toEqual({ theme: 'auto', fontSize: 18, language: 'ja' });

      settings.dispose();
    });

    it('current-version data returned directly without migration', async () => {
      const driver = memoryDriver();
      const currentData: SettingsV3 = { theme: 'dark', fontSize: 14, language: 'en' };

      const settings = atom<SettingsV3>(
        'settings',
        withDriver(driver),
        withMiddleware(
          versioned({
            current: 3,
            migrate: {
              1: (d: SettingsV1) => ({ ...d, fontSize: 14 }),
              2: (d: SettingsV2) => ({ ...d, language: 'en' }),
            },
          }),
        ),
      );

      await settings.set(currentData);
      const result = await settings.get();
      expect(result).toEqual(currentData);

      settings.dispose();
    });
  });

  describe('error scenarios', () => {
    it('throws clear error when data version exceeds code version', async () => {
      const driver = memoryDriver();
      await driver.set('settings', { $v: { future: true }, $m: { ver: 5 } });

      const settings = atom<SettingsV3>(
        'settings',
        withDriver(driver),
        withMiddleware(versioned({ current: 3, migrate: {} })),
      );

      await expect(settings.get()).rejects.toThrow(/newer than current/);

      settings.dispose();
    });

    it('throws clear error when migration step is missing', async () => {
      const driver = memoryDriver();
      await driver.set('settings', { $v: { theme: 'light' }, $m: { ver: 1 } });

      const settings = atom<SettingsV3>(
        'settings',
        withDriver(driver),
        withMiddleware(
          versioned({
            current: 3,
            migrate: {
              1: (d: SettingsV1) => ({ ...d, fontSize: 14 }),
              // missing v2 -> v3 migration
            },
          }),
        ),
      );

      await expect(settings.get()).rejects.toThrow(/Missing migration/);

      settings.dispose();
    });

    it('migration function exception propagates to caller', async () => {
      const driver = memoryDriver();
      await driver.set('settings', { $v: { theme: 'light' }, $m: { ver: 1 } });

      const settings = atom(
        'settings',
        withDriver(driver),
        withMiddleware(
          versioned({
            current: 2,
            migrate: {
              1: () => {
                throw new Error('corrupt data, cannot migrate');
              },
            },
          }),
        ),
      );

      await expect(settings.get()).rejects.toThrow('corrupt data, cannot migrate');

      settings.dispose();
    });
  });

  describe('migration with other middleware', () => {
    it('validate ensures migrated data structure is correct', async () => {
      const driver = memoryDriver();
      await driver.set('settings', { $v: { theme: 'light' }, $m: { ver: 1 } });

      const settings = atom<SettingsV3>(
        'settings',
        withDriver(driver),
        withMiddleware(
          validate(isValidSettings),
          versioned({
            current: 3,
            migrate: {
              1: (d: SettingsV1) => ({ ...d, fontSize: 14 }),
              2: (d: SettingsV2) => ({ ...d, language: 'en' }),
            },
          }),
        ),
      );

      // migration produces valid v3 structure, validate passes
      const result = await settings.get();
      expect(result).toEqual({ theme: 'light', fontSize: 14, language: 'en' });

      settings.dispose();
    });

    it('cached caches migrated result, second read hits cache directly', async () => {
      const driver = memoryDriver();
      await driver.set('settings', { $v: { theme: 'dark' }, $m: { ver: 1 } });

      let migrateCount = 0;
      const settings = atom<SettingsV3>(
        'settings',
        withDriver(driver),
        withMiddleware(
          versioned({
            current: 3,
            migrate: {
              1: (d: SettingsV1) => {
                migrateCount++;
                return { ...d, fontSize: 14 };
              },
              2: (d: SettingsV2) => {
                migrateCount++;
                return { ...d, language: 'en' };
              },
            },
          }),
          cached(),
        ),
      );

      await settings.get();
      expect(migrateCount).toBe(2);

      migrateCount = 0;
      await settings.get();
      // cached hit, entire pipeline including versioned is skipped
      expect(migrateCount).toBe(0);

      settings.dispose();
    });
  });
});
