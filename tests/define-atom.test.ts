import { defineAtom } from '../src/define-atom';
import { withDriver, withScope, withMiddleware, withPreMiddleware } from '../src/modifiers';
import { createScope } from '../src/scope';
import { memoryDriver } from '../src/drivers/memory';
import { debounce } from '../src/middleware/debounce';
import type { MiddlewareFunction } from '../src/types';

describe('defineAtom', () => {
  it('defineAtom creates atom factory with base modifiers', () => {
    const driver = memoryDriver();
    const scope = createScope('app');
    const createAtom = defineAtom(() => [withDriver(driver), withScope(scope)]);

    const a = createAtom<string>('user');

    expect(a.key).toBe('app:user');

    a.dispose();
  });

  it('atoms from factory share same driver and scope config', async () => {
    const driver = memoryDriver();
    const scope = createScope('shared');
    const createAtom = defineAtom(() => [withDriver(driver), withScope(scope)]);

    const a = createAtom<string>('one');
    const b = createAtom<string>('two');

    await a.set('alpha');
    await b.set('beta');

    expect(a.key).toBe('shared:one');
    expect(b.key).toBe('shared:two');
    await expect(a.get()).resolves.toBe('alpha');
    await expect(b.get()).resolves.toBe('beta');
    expect(await driver.get('shared:one')).toEqual({ $v: 'alpha' });
    expect(await driver.get('shared:two')).toEqual({ $v: 'beta' });

    a.dispose();
    b.dispose();
  });

  it('withPreMiddleware inserts before base middleware', async () => {
    const order: string[] = [];
    const baseMw: MiddlewareFunction = async (_ctx, next) => {
      order.push('base');
      await next();
    };
    const preMw: MiddlewareFunction = async (_ctx, next) => {
      order.push('pre');
      await next();
    };

    const createAtom = defineAtom(() => [withMiddleware(baseMw)]);
    const a = createAtom('key', withPreMiddleware(preMw), withDriver(memoryDriver()));

    await a.set(1);

    expect(order).toEqual(['pre', 'base']);

    a.dispose();
  });

  it('withMiddleware appends after base middleware', async () => {
    const order: string[] = [];
    const baseMw: MiddlewareFunction = async (_ctx, next) => {
      order.push('base');
      await next();
    };
    const postMw: MiddlewareFunction = async (_ctx, next) => {
      order.push('post');
      await next();
    };

    const createAtom = defineAtom(() => [withMiddleware(baseMw)]);
    const a = createAtom('key', withMiddleware(postMw), withDriver(memoryDriver()));

    await a.set(1);

    expect(order).toEqual(['base', 'post']);

    a.dispose();
  });

  it('middleware execution order: preMiddleware → baseMiddleware → withMiddleware', async () => {
    const order: string[] = [];
    const baseMw: MiddlewareFunction = async (_ctx, next) => {
      order.push('base');
      await next();
    };
    const preMw: MiddlewareFunction = async (_ctx, next) => {
      order.push('pre');
      await next();
    };
    const postMw: MiddlewareFunction = async (_ctx, next) => {
      order.push('post');
      await next();
    };

    const createAtom = defineAtom(() => [withMiddleware(baseMw)]);
    const a = createAtom(
      'key',
      withPreMiddleware(preMw),
      withMiddleware(postMw),
      withDriver(memoryDriver()),
    );

    await a.set(1);

    expect(order).toEqual(['pre', 'base', 'post']);

    a.dispose();
  });

  it('factory receives the key parameter', () => {
    const receivedKeys: string[] = [];
    const createAtom = defineAtom((key) => {
      receivedKeys.push(key);
      return [withDriver(memoryDriver())];
    });

    const a = createAtom<string>('first');
    const b = createAtom<string>('second');

    expect(receivedKeys).toEqual(['first', 'second']);

    a.dispose();
    b.dispose();
  });

  it('stateful middleware gets independent instances per atom', async () => {
    vi.useFakeTimers();
    const driver = memoryDriver();

    const createAtom = defineAtom(() => [withDriver(driver), withMiddleware(debounce(50))]);

    const a = createAtom<string>('key-a');
    const b = createAtom<string>('key-b');

    await a.set('value-a');
    await b.set('value-b');

    // Each atom has its own debounce instance, so both pending values are independent
    expect(await a.get()).toBe('value-a');
    expect(await b.get()).toBe('value-b');

    a.dispose();
    b.dispose();
    vi.useRealTimers();
  });
});
