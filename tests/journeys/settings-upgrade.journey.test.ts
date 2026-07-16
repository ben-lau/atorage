import { atom } from '../../src/atom';
import { withDriver, withMiddleware } from '../../src/modifiers';
import { memoryDriver } from '../../src/drivers/memory';
import { cached } from '../../src/middleware/cached';
import { validate } from '../../src/middleware/validate';
import { versioned } from '../../src/middleware/versioned';

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

const migrate = {
  1: (d: SettingsV1): SettingsV2 => ({ ...d, fontSize: 14 }),
  2: (d: SettingsV2): SettingsV3 => ({ ...d, language: 'zh-CN' }),
};

describe('journey: app upgrade settings migration', () => {
  it('old install → new app reads migrated settings → restart skips migrate', async () => {
    const driver = memoryDriver();

    // Old app wrote v1
    await driver.set('settings', { $v: { theme: 'light' }, $m: { ver: 1 } });

    let migrateCalls = 0;
    const countingMigrate = {
      1: (d: SettingsV1) => {
        migrateCalls++;
        return migrate[1](d);
      },
      2: (d: SettingsV2) => {
        migrateCalls++;
        return migrate[2](d);
      },
    };

    const settings = atom<SettingsV3>(
      'settings',
      withDriver(driver),
      withMiddleware(
        validate(isValidSettings),
        versioned({ current: 3, migrate: countingMigrate }),
        cached(),
      ),
    );

    expect(await settings.get()).toEqual({
      theme: 'light',
      fontSize: 14,
      language: 'zh-CN',
    });
    expect(migrateCalls).toBe(2);

    const raw = (await driver.get('settings')) as { $m: { ver: number } };
    expect(raw.$m.ver).toBe(3);

    settings.dispose();

    // Second app start
    migrateCalls = 0;
    const settings2 = atom<SettingsV3>(
      'settings',
      withDriver(driver),
      withMiddleware(
        validate(isValidSettings),
        versioned({ current: 3, migrate: countingMigrate }),
        cached(),
      ),
    );

    expect(await settings2.get()).toEqual({
      theme: 'light',
      fontSize: 14,
      language: 'zh-CN',
    });
    expect(migrateCalls).toBe(0);

    settings2.dispose();
  });

  it('future data version fails clearly for the user', async () => {
    const driver = memoryDriver();
    await driver.set('settings', { $v: { future: true }, $m: { ver: 5 } });

    const settings = atom<SettingsV3>(
      'settings',
      withDriver(driver),
      withMiddleware(versioned({ current: 3, migrate })),
    );

    await expect(settings.get()).rejects.toThrow(/newer than current/);

    settings.dispose();
  });
});
