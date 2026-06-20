import type {
  Atom,
  AtomChangeEventDetail,
  AtomConfig,
  AtomErrorEventDetail,
  AtomModifier,
  Driver,
  Middleware,
  MiddlewareContext,
  MiddlewareWithHooks,
} from './types.js';
import { AtomDisposedError, StorageError } from './errors.js';
import { wrap, unwrap } from './core/wrap.js';
import { AsyncMutex } from './core/mutex.js';
import { eventBus } from './core/event-bus.js';
import { executePipeline } from './core/pipeline.js';
import { degradedGet, degradedSet, degradedDel } from './core/degradation.js';
import { isBatching, deferEvent, deferBusNotify } from './batch.js';

let atomIdCounter = 0;

function isMiddlewareWithHooks(mw: Middleware): mw is MiddlewareWithHooks {
  return typeof mw !== 'function' && 'handle' in mw;
}

function createEmptyConfig<T>(): AtomConfig<T> {
  return {
    drivers: [],
    scopes: [],
    middleware: [],
    preMiddleware: [],
  };
}

class AtomImpl<T> extends EventTarget implements Atom<T> {
  readonly key: string;

  private _atomId: string;
  private _drivers: Driver[];
  private _middleware: Middleware[];
  private _disposed = false;
  private _mutex = new AsyncMutex();
  private _scopeCleanups: Array<() => void> = [];
  private _driversReady: Promise<void>;

  constructor(key: string, config: AtomConfig<T>) {
    super();
    this._atomId = `atom_${++atomIdCounter}`;

    const scopes = [...new Set(config.scopes)];
    const prefix = scopes.map((s) => s.name).join(':');
    this.key = prefix ? `${prefix}:${key}` : key;

    this._drivers = [...new Set(config.drivers)];
    this._middleware = [...config.preMiddleware, ...config.middleware];

    this._registerEventBus();
    this._registerScopes(scopes);
    this._driversReady = this._filterDrivers();
    this._initMiddleware();
  }

  // ── Public API ──────────────────────────────────

  async get(): Promise<T | undefined> {
    this._ensureAlive();
    return this._doGet();
  }

  async set(value: T): Promise<void> {
    this._ensureAlive();
    try {
      await this._doSet(value);
    } catch (err) {
      this._dispatchError(err instanceof Error ? err : new Error(String(err)));
      throw err;
    }
  }

  async del(): Promise<void> {
    this._ensureAlive();
    try {
      const errors: Error[] = [];

      const ctx: MiddlewareContext = {
        key: this.key,
        operation: 'del',
        value: undefined,
        meta: {},
        requestWriteback: () => {},
        requestDelete: () => {},
        reportError: (err) => {
          errors.push(err);
        },
      };

      await executePipeline(this._middleware, ctx, async () => {
        await this._ensureDrivers();
        await degradedDel(this._drivers, this.key);
        this._dispatchDelete();
        this._notifyBus('delete');
      });

      for (const err of errors) this._dispatchError(err);
    } catch (err) {
      this._dispatchError(err instanceof Error ? err : new Error(String(err)));
      throw err;
    }
  }

  async has(): Promise<boolean> {
    this._ensureAlive();
    try {
      await this._ensureDrivers();
      const stored = await degradedGet(this._drivers, this.key);
      const { value, meta } = unwrap(stored);

      const errors: Error[] = [];
      const ctx: MiddlewareContext = {
        key: this.key,
        operation: 'has',
        value,
        meta,
        requestWriteback: () => {},
        requestDelete: () => {},
        reportError: (err) => {
          errors.push(err);
        },
      };

      await executePipeline(this._middleware, ctx, async () => {});

      for (const err of errors) this._dispatchError(err);
      return ctx.value !== undefined;
    } catch (err) {
      this._dispatchError(err instanceof Error ? err : new Error(String(err)));
      throw err;
    }
  }

  async update(updater: (prev: T | undefined) => T | Promise<T>): Promise<T> {
    this._ensureAlive();
    return this._mutex.run(async () => {
      this._ensureAlive();
      try {
        const prev = (await this._doGet()) as T | undefined;
        const next = await updater(prev);
        await this._doSet(next);
        return next;
      } catch (err) {
        this._dispatchError(err instanceof Error ? err : new Error(String(err)));
        throw err;
      }
    });
  }

  async getMeta(): Promise<Record<string, unknown> | undefined> {
    this._ensureAlive();
    try {
      await this._ensureDrivers();
      const stored = await degradedGet(this._drivers, this.key);
      if (stored === undefined) return undefined;
      const { meta } = unwrap(stored);
      return Object.keys(meta).length > 0 ? meta : undefined;
    } catch (err) {
      this._dispatchError(err instanceof Error ? err : new Error(String(err)));
      throw err;
    }
  }

  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;

    eventBus.unregister(this.key, this._atomId);

    for (const cleanup of this._scopeCleanups) {
      cleanup();
    }
    this._scopeCleanups = [];

    for (const mw of this._middleware) {
      if (isMiddlewareWithHooks(mw) && mw.onDispose) {
        mw.onDispose();
      }
    }
  }

  // ── Internal ────────────────────────────────────

  private async _ensureDrivers(): Promise<void> {
    await this._driversReady;
    if (this._drivers.length === 0) {
      throw new StorageError(
        `Atom "${this.key}" has no available drivers. Did you forget withDriver()?`,
      );
    }
  }

  private async _doGet(): Promise<T | undefined> {
    try {
      let writebackRequested = false;
      let deleteRequested = false;
      const errors: Error[] = [];
      const ctx: MiddlewareContext = {
        key: this.key,
        operation: 'get',
        value: undefined,
        meta: {},
        requestWriteback: () => {
          writebackRequested = true;
        },
        requestDelete: () => {
          deleteRequested = true;
        },
        reportError: (err) => {
          errors.push(err);
        },
      };

      await executePipeline(this._middleware, ctx, async () => {
        await this._ensureDrivers();
        const stored = await degradedGet(this._drivers, this.key);
        const { value, meta } = unwrap(stored);
        ctx.value = value;
        Object.assign(ctx.meta, meta);
      });

      if (writebackRequested && ctx.value !== undefined) {
        await this._doWriteback(ctx.value as T, ctx.meta);
      }

      if (deleteRequested && ctx.value === undefined) {
        await this._doSilentDel();
      }

      for (const err of errors) this._dispatchError(err);

      return ctx.value as T | undefined;
    } catch (err) {
      this._dispatchError(err instanceof Error ? err : new Error(String(err)));
      throw err;
    }
  }

  private async _doSet(value: T): Promise<void> {
    const ctx: MiddlewareContext = {
      key: this.key,
      operation: 'set',
      value,
      meta: {},
      requestWriteback: () => {},
      requestDelete: () => {},
      reportError: (err) => {
        this._dispatchError(err);
      },
    };

    await executePipeline(this._middleware, ctx, async () => {
      await this._ensureDrivers();
      const wrapped = wrap(ctx.value, ctx.meta);
      await degradedSet(this._drivers, this.key, wrapped);
      this._dispatchChange(ctx.value as T | undefined);
      this._notifyBus('change', ctx.value);
    });
  }

  private async _doWriteback(value: T, meta: Record<string, unknown>): Promise<void> {
    const ctx: MiddlewareContext = {
      key: this.key,
      operation: 'set',
      value,
      meta: { ...meta },
      requestWriteback: () => {},
      requestDelete: () => {},
      reportError: (err) => {
        this._dispatchError(err);
      },
    };

    await executePipeline(this._middleware, ctx, async () => {
      await this._ensureDrivers();
      const wrapped = wrap(ctx.value, ctx.meta);
      await degradedSet(this._drivers, this.key, wrapped);
    });
  }

  private async _doSilentDel(): Promise<void> {
    await this._ensureDrivers();
    for (const driver of this._drivers) {
      await driver.del(this.key).catch(() => {});
    }
  }

  private _registerEventBus(): void {
    eventBus.register(this.key, this._atomId, (event) => {
      if (event.type === 'change') {
        this._dispatchChange(event.value as T | undefined);
        this._callExternalChangeHooks();
      } else if (event.type === 'delete') {
        this._dispatchDelete();
        this._callExternalChangeHooks();
      }
    });
  }

  private _callExternalChangeHooks(): void {
    for (const mw of this._middleware) {
      if (isMiddlewareWithHooks(mw) && mw.onExternalChange) {
        mw.onExternalChange(this.key);
      }
    }
  }

  private _initMiddleware(): void {
    for (const mw of this._middleware) {
      if (isMiddlewareWithHooks(mw) && mw.onInit) {
        mw.onInit({ key: this.key, atomId: this._atomId });
      }
    }
  }

  private _registerScopes(scopes: AtomConfig<T>['scopes']): void {
    for (const scope of scopes) {
      const cleanup = scope._register(async () => {
        if (!this._disposed) {
          await this.del().catch((err) => {
            this._dispatchError(err instanceof Error ? err : new Error(String(err)));
          });
        }
      });
      this._scopeCleanups.push(cleanup);
    }
  }

  private async _filterDrivers(): Promise<void> {
    const filtered: Driver[] = [];
    for (const driver of this._drivers) {
      if (driver.available) {
        try {
          const result = await driver.available();
          if (result) {
            filtered.push(driver);
          }
        } catch {
          // available() threw or rejected → treat as unavailable
        }
      } else {
        filtered.push(driver);
      }
    }
    this._drivers = filtered;
  }

  private _ensureAlive(): void {
    if (this._disposed) {
      throw new AtomDisposedError(this.key);
    }
  }

  private _dispatchChange(value: T | undefined): void {
    const event = new CustomEvent('change', {
      detail: { value } satisfies AtomChangeEventDetail<T>,
    });
    if (isBatching()) {
      deferEvent(this.key, this._atomId, this, event);
    } else {
      try {
        this.dispatchEvent(event);
      } catch {
        // Listener errors must not propagate to the caller of set/del
      }
    }
  }

  private _dispatchDelete(): void {
    const event = new Event('delete');
    if (isBatching()) {
      deferEvent(this.key, this._atomId, this, event);
    } else {
      try {
        this.dispatchEvent(event);
      } catch {
        // Listener errors must not propagate to the caller of set/del
      }
    }
  }

  private _notifyBus(type: string, value?: unknown): void {
    const event = { type, value };
    if (isBatching()) {
      deferBusNotify(this.key, this._atomId, event);
    } else {
      eventBus.notify(this.key, this._atomId, event);
    }
  }

  private _dispatchError(error: Error): void {
    this.dispatchEvent(
      new CustomEvent('error', {
        detail: { error } satisfies AtomErrorEventDetail,
      }),
    );
  }
}

export function atom<T>(key: string, ...modifiers: AtomModifier<T>[]): Atom<T> {
  let config = createEmptyConfig<T>();
  for (const modifier of modifiers) {
    config = modifier(config);
  }
  return new AtomImpl<T>(key, config);
}
