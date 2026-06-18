import { eventBus } from '../../src/core/event-bus';

describe('eventBus', () => {
  beforeEach(() => {
    eventBus._clear();
  });

  it('register + notify: callback is called', () => {
    const callback = vi.fn();
    eventBus.register('my-key', 'atom-1', callback);

    const event = { type: 'update', value: 42 };
    eventBus.notify('my-key', 'atom-2', event);

    expect(callback).toHaveBeenCalledOnce();
    expect(callback).toHaveBeenCalledWith(event);
  });

  it('notify excludes source atom', () => {
    const callback = vi.fn();
    eventBus.register('my-key', 'atom-1', callback);

    eventBus.notify('my-key', 'atom-1', { type: 'update', value: 1 });

    expect(callback).not.toHaveBeenCalled();
  });

  it('multiple atoms on same key: all except source receive notification', () => {
    const callback1 = vi.fn();
    const callback2 = vi.fn();
    const callback3 = vi.fn();

    eventBus.register('my-key', 'atom-1', callback1);
    eventBus.register('my-key', 'atom-2', callback2);
    eventBus.register('my-key', 'atom-3', callback3);

    const event = { type: 'update', value: 'shared' };
    eventBus.notify('my-key', 'atom-2', event);

    expect(callback1).toHaveBeenCalledOnce();
    expect(callback1).toHaveBeenCalledWith(event);
    expect(callback2).not.toHaveBeenCalled();
    expect(callback3).toHaveBeenCalledOnce();
    expect(callback3).toHaveBeenCalledWith(event);
  });

  it('different keys are isolated', () => {
    const callbackA = vi.fn();
    const callbackB = vi.fn();

    eventBus.register('key-a', 'atom-1', callbackA);
    eventBus.register('key-b', 'atom-2', callbackB);

    eventBus.notify('key-a', 'atom-3', { type: 'update', value: 'a' });

    expect(callbackA).toHaveBeenCalledOnce();
    expect(callbackB).not.toHaveBeenCalled();
  });

  it('unregister: callback no longer called after unregister', () => {
    const callback = vi.fn();
    eventBus.register('my-key', 'atom-1', callback);

    eventBus.unregister('my-key', 'atom-1');
    eventBus.notify('my-key', 'atom-2', { type: 'update', value: 1 });

    expect(callback).not.toHaveBeenCalled();
  });

  it('unregister cleans up empty key maps', () => {
    eventBus.register('my-key', 'atom-1', vi.fn());
    eventBus.unregister('my-key', 'atom-1');

    expect(() => {
      eventBus.notify('my-key', 'atom-2', { type: 'update' });
    }).not.toThrow();
  });

  it('notify with no listeners for key: no error', () => {
    expect(() => {
      eventBus.notify('unknown-key', 'atom-1', { type: 'update' });
    }).not.toThrow();
  });
});
