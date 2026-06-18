import { AsyncMutex } from '../../src/core/mutex';

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('AsyncMutex', () => {
  it('executes concurrent run() calls sequentially', async () => {
    const mutex = new AsyncMutex();
    const order: number[] = [];

    const first = mutex.run(async () => {
      order.push(1);
      await delay(20);
      order.push(2);
    });

    const second = mutex.run(async () => {
      order.push(3);
    });

    await Promise.all([first, second]);
    expect(order).toEqual([1, 2, 3]);
  });

  it('returns fn result from run()', async () => {
    const mutex = new AsyncMutex();
    const result = await mutex.run(async () => 42);
    expect(result).toBe(42);
  });

  it('propagates errors from fn to the caller', async () => {
    const mutex = new AsyncMutex();
    const error = new Error('boom');

    await expect(
      mutex.run(async () => {
        throw error;
      }),
    ).rejects.toBe(error);
  });

  it('continues processing after a failed run()', async () => {
    const mutex = new AsyncMutex();
    const order: number[] = [];

    await expect(
      mutex.run(async () => {
        order.push(1);
        throw new Error('fail');
      }),
    ).rejects.toThrow('fail');

    await mutex.run(async () => {
      order.push(2);
    });

    expect(order).toEqual([1, 2]);
  });

  it('executes 10 concurrent run() calls in order', async () => {
    const mutex = new AsyncMutex();
    const order: number[] = [];

    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        mutex.run(async () => {
          order.push(i);
          await delay(5);
        }),
      ),
    );

    expect(order).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });
});
