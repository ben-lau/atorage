import { atom } from '../../src/atom';
import { withDriver, withMiddleware } from '../../src/modifiers';
import { memoryDriver } from '../../src/drivers/memory';
import { debounce } from '../../src/middleware/debounce';

const DEBOUNCE_MS = 100;

function spyDriver() {
  const driver = memoryDriver();
  let setCount = 0;
  let getCount = 0;

  return {
    ...driver,
    set: async (key: string, value: unknown) => {
      setCount++;
      return driver.set(key, value);
    },
    get: async (key: string) => {
      getCount++;
      return driver.get(key);
    },
    setCount: () => setCount,
    getCount: () => getCount,
  };
}

describe('debounce middleware', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function createAtom(driver = spyDriver()) {
    return {
      atom: atom<string>('debounce-key', withDriver(driver), withMiddleware(debounce(DEBOUNCE_MS))),
      driver,
    };
  }

  it('single set: value is written after debounce period', async () => {
    const { atom: a, driver } = createAtom();

    const setPromise = a.set('hello');
    expect(driver.setCount()).toBe(0);

    await setPromise;
    expect(driver.setCount()).toBe(0);

    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    expect(driver.setCount()).toBe(1);

    await expect(a.get()).resolves.toBe('hello');
    a.dispose();
  });

  it('multiple rapid sets: only the last value is written to driver', async () => {
    const { atom: a, driver } = createAtom();

    await Promise.all([a.set('first'), a.set('second'), a.set('third')]);
    expect(driver.setCount()).toBe(0);

    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    expect(driver.setCount()).toBe(1);

    await expect(a.get()).resolves.toBe('third');
    a.dispose();
  });

  it('get during debounce returns the pending value', async () => {
    const { atom: a, driver } = createAtom();

    await a.set('pending');
    expect(driver.setCount()).toBe(0);

    await expect(a.get()).resolves.toBe('pending');
    expect(driver.getCount()).toBe(0);

    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    a.dispose();
  });

  it('del during debounce cancels the pending write', async () => {
    const { atom: a, driver } = createAtom();

    await a.set('to-be-cancelled');
    await a.del();

    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    expect(driver.setCount()).toBe(0);

    await expect(a.get()).resolves.toBeUndefined();
    a.dispose();
  });

  it('after debounce fires, get reads from driver', async () => {
    const { atom: a, driver } = createAtom();

    await a.set('flushed');
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);

    driver.getCount();
    await expect(a.get()).resolves.toBe('flushed');
    expect(driver.getCount()).toBe(1);

    a.dispose();
  });
});
