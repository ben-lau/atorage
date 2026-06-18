import { atom } from '../../src/atom';
import { withDriver, withMiddleware } from '../../src/modifiers';
import { memoryDriver } from '../../src/drivers/memory';
import { logger } from '../../src/middleware/logger';

describe('logger middleware', () => {
  it('logs operation, key, and timing', async () => {
    const log = vi.fn();
    const a = atom<string>('log-key', withDriver(memoryDriver()), withMiddleware(logger({ log })));

    await a.set('hello');
    await a.get();

    expect(log).toHaveBeenCalledTimes(2);
    expect(log.mock.calls[0][0]).toMatch(/^\[atorage\] set log-key \(\d+\.\d{2}ms\)$/);
    expect(log.mock.calls[1][0]).toMatch(/^\[atorage\] get log-key \(\d+\.\d{2}ms\)$/);

    a.dispose();
  });

  it('custom log function receives the message', async () => {
    const log = vi.fn();
    const a = atom<string>(
      'custom-log-key',
      withDriver(memoryDriver()),
      withMiddleware(logger({ log })),
    );

    await a.get();

    expect(log).toHaveBeenCalledOnce();
    expect(log.mock.calls[0][0]).toContain('[atorage] get custom-log-key');

    a.dispose();
  });

  it('works for get, set, del operations', async () => {
    const log = vi.fn();
    const a = atom<string>('ops-key', withDriver(memoryDriver()), withMiddleware(logger({ log })));

    await a.set('value');
    await a.del();

    expect(log).toHaveBeenCalledTimes(3);
    expect(log.mock.calls[0][0]).toContain('set ops-key');
    expect(log.mock.calls[1][0]).toContain('get ops-key');
    expect(log.mock.calls[2][0]).toContain('del ops-key');

    a.dispose();
  });
});
