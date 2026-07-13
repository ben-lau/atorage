import { eventBus } from '../../src/core/event-bus';
import { memoryDriver } from '../../src/drivers/memory';

describe('eventBus', () => {
  beforeEach(() => {
    eventBus._clear();
  });

  it('register + notify: callback is called when drivers overlap', () => {
    const driver = memoryDriver();
    const callback = vi.fn();
    eventBus.register('my-key', 'atom-1', [driver], callback);

    const event = { type: 'update', value: 42 };
    eventBus.notify('my-key', 'atom-2', [driver], event);

    expect(callback).toHaveBeenCalledOnce();
    expect(callback).toHaveBeenCalledWith(event);
  });

  it('notify excludes source atom', () => {
    const driver = memoryDriver();
    const callback = vi.fn();
    eventBus.register('my-key', 'atom-1', [driver], callback);

    eventBus.notify('my-key', 'atom-1', [driver], { type: 'update', value: 1 });

    expect(callback).not.toHaveBeenCalled();
  });

  it('multiple atoms on same key: all except source with shared driver receive notification', () => {
    const driver = memoryDriver();
    const callback1 = vi.fn();
    const callback2 = vi.fn();
    const callback3 = vi.fn();

    eventBus.register('my-key', 'atom-1', [driver], callback1);
    eventBus.register('my-key', 'atom-2', [driver], callback2);
    eventBus.register('my-key', 'atom-3', [driver], callback3);

    const event = { type: 'update', value: 'shared' };
    eventBus.notify('my-key', 'atom-2', [driver], event);

    expect(callback1).toHaveBeenCalledOnce();
    expect(callback1).toHaveBeenCalledWith(event);
    expect(callback2).not.toHaveBeenCalled();
    expect(callback3).toHaveBeenCalledOnce();
    expect(callback3).toHaveBeenCalledWith(event);
  });

  it('different keys are isolated', () => {
    const driver = memoryDriver();
    const callbackA = vi.fn();
    const callbackB = vi.fn();

    eventBus.register('key-a', 'atom-1', [driver], callbackA);
    eventBus.register('key-b', 'atom-2', [driver], callbackB);

    eventBus.notify('key-a', 'atom-3', [driver], { type: 'update', value: 'a' });

    expect(callbackA).toHaveBeenCalledOnce();
    expect(callbackB).not.toHaveBeenCalled();
  });

  it('same key but different drivers: no notification without shared driver', () => {
    const driver1 = memoryDriver();
    const driver2 = memoryDriver();
    const callback1 = vi.fn();
    const callback2 = vi.fn();

    eventBus.register('my-key', 'atom-1', [driver1], callback1);
    eventBus.register('my-key', 'atom-2', [driver2], callback2);

    eventBus.notify('my-key', 'atom-3', [driver1], { type: 'update', value: 'a' });

    expect(callback1).toHaveBeenCalledOnce();
    expect(callback2).not.toHaveBeenCalled();
  });

  it('notifies when drivers share the same backendId', () => {
    const driver1: ReturnType<typeof memoryDriver> = {
      ...memoryDriver(),
      backendId: 'localStorage',
    };
    const driver2: ReturnType<typeof memoryDriver> = {
      ...memoryDriver(),
      backendId: 'localStorage',
    };
    const callback = vi.fn();

    eventBus.register('my-key', 'atom-1', [driver1], callback);

    const event = { type: 'change', value: 'x' };
    eventBus.notify('my-key', 'atom-2', [driver2], event);

    expect(callback).toHaveBeenCalledOnce();
    expect(callback).toHaveBeenCalledWith(event);
  });

  it('skipDriverCheck notifies all listeners regardless of driver', () => {
    const driver1 = memoryDriver();
    const driver2 = memoryDriver();
    const callback1 = vi.fn();
    const callback2 = vi.fn();

    eventBus.register('my-key', 'atom-1', [driver1], callback1);
    eventBus.register('my-key', 'atom-2', [driver2], callback2);

    const event = { type: 'change' };
    eventBus.notify('my-key', 'atom-3', [], event, { skipDriverCheck: true });

    expect(callback1).toHaveBeenCalledOnce();
    expect(callback2).toHaveBeenCalledOnce();
    expect(callback1).toHaveBeenCalledWith(event);
    expect(callback2).toHaveBeenCalledWith(event);
  });

  it('unregister: callback no longer called after unregister', () => {
    const driver = memoryDriver();
    const callback = vi.fn();
    eventBus.register('my-key', 'atom-1', [driver], callback);

    eventBus.unregister('my-key', 'atom-1');
    eventBus.notify('my-key', 'atom-2', [driver], { type: 'update', value: 1 });

    expect(callback).not.toHaveBeenCalled();
  });

  it('unregister cleans up empty key maps', () => {
    const driver = memoryDriver();
    eventBus.register('my-key', 'atom-1', [driver], vi.fn());
    eventBus.unregister('my-key', 'atom-1');

    expect(() => {
      eventBus.notify('my-key', 'atom-2', [driver], { type: 'update' });
    }).not.toThrow();
  });

  it('notify with no listeners for key: no error', () => {
    expect(() => {
      eventBus.notify('unknown-key', 'atom-1', [], { type: 'update' });
    }).not.toThrow();
  });
});
