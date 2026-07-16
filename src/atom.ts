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
} from './types';
import { AtomDisposedError, StorageError } from './errors';
import { wrap, unwrap } from './core/wrap';
import { AsyncMutex } from './core/mutex';
import { executePipeline } from './core/pipeline';
import { degradedGet, degradedSet, degradedDel } from './core/degradation';
import { isBatching, deferEvent } from './batch';

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
  private _refreshing = false;

  constructor(key: string, config: AtomConfig<T>) {
    super();
    this._atomId = `atom_${++atomIdCounter}`;

    const scopes = [...new Set(config.scopes)];
    const prefix = scopes.map((s) => s.name).join(':');
    this.key = prefix ? `${prefix}:${key}` : key;

    this._drivers = [...new Set(config.drivers)];
    this._middleware = [...config.preMiddleware, ...config.middleware];

    this._registerScopes(scopes);
    this._initMiddleware();
    this._driversReady = this._filterDrivers();
  }

  // ── Public API ──────────────────────────────────

  async get(): Promise<T | undefined> {
    this._ensureAlive();
    return this._run(() => this._doGet());
  }

  async set(value: T): Promise<void> {
    this._ensureAlive();
    return this._run(() => this._doSet(value));
  }

  async del(): Promise<void> {
    this._ensureAlive();
    return this._run(async () => {
      const { ctx, errors } = this._createContext('del');

      await executePipeline(this._middleware, ctx, async () => {
        await this._ensureDrivers();
        await degradedDel(this._drivers, this.key);
        this._dispatchDelete();
      });

      this._flushErrors(errors);
    });
  }

  async has(): Promise<boolean> {
    this._ensureAlive();
    return this._run(async () => {
      await this._ensureDrivers();
      const stored = await degradedGet(this._drivers, this.key, (err) => this._dispatchError(err));
      const { value, meta } = unwrap(stored);

      const { ctx, flags, errors } = this._createContext('has', value, meta);

      await executePipeline(this._middleware, ctx, async () => {});

      await this._applyReadFlags(ctx, flags);

      this._flushErrors(errors);
      return ctx.value !== undefined;
    });
  }

  async update(updater: (prev: T | undefined) => T | Promise<T>): Promise<T> {
    this._ensureAlive();
    return this._mutex.run(() =>
      this._run(async () => {
        this._ensureAlive();
        const prev = (await this._doGet()) as T | undefined;
        const next = await updater(prev);
        await this._doSet(next);
        return next;
      }),
    );
  }

  async getMeta(): Promise<Record<string, unknown> | undefined> {
    this._ensureAlive();
    return this._run(async () => {
      await this._ensureDrivers();
      const stored = await degradedGet(this._drivers, this.key, (err) => this._dispatchError(err));
      if (stored === undefined) return undefined;
      const { meta } = unwrap(stored);
      return Object.keys(meta).length > 0 ? meta : undefined;
    });
  }

  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;

    for (const cleanup of this._scopeCleanups) {
      cleanup();
    }
    this._scopeCleanups = [];

    for (const mw of this._middleware) {
      if (isMiddlewareWithHooks(mw) && mw.onDispose) {
        mw.onDispose({ key: this.key, atomId: this._atomId });
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

  private _createContext(
    operation: MiddlewareContext['operation'],
    value?: unknown,
    meta?: Record<string, unknown>,
  ): { ctx: MiddlewareContext; flags: { writeback: boolean; delete: boolean }; errors: Error[] } {
    const errors: Error[] = [];
    const flags = { writeback: false, delete: false };
    return {
      ctx: {
        key: this.key,
        atomId: this._atomId,
        operation,
        value,
        meta: meta ? { ...meta } : {},
        requestWriteback: () => {
          flags.writeback = true;
        },
        requestDelete: () => {
          flags.delete = true;
        },
        reportError: (err) => {
          errors.push(err);
        },
        refresh: () => this._refresh(),
      },
      flags,
      errors,
    };
  }

  private _flushErrors(errors: Error[]): void {
    for (const err of errors) this._dispatchError(err);
  }

  private async _run<R>(fn: () => Promise<R>): Promise<R> {
    try {
      return await fn();
    } catch (err) {
      this._dispatchError(err instanceof Error ? err : new Error(String(err)));
      throw err;
    }
  }

  private async _refresh(): Promise<void> {
    this._ensureAlive();
    if (this._refreshing) return;
    this._refreshing = true;
    try {
      await this._run(async () => {
        const { ctx, flags, errors } = this._createContext('refresh');

        await executePipeline(this._middleware, ctx, async () => {
          await this._ensureDrivers();
          const stored = await degradedGet(this._drivers, this.key, ctx.reportError);
          const { value, meta } = unwrap(stored);
          ctx.value = value;
          Object.assign(ctx.meta, meta);
        });

        await this._applyReadFlags(ctx, flags);

        if (ctx.value === undefined) {
          this._dispatchDelete();
        } else {
          this._dispatchChange(ctx.value as T);
        }

        this._flushErrors(errors);
      });
    } finally {
      this._refreshing = false;
    }
  }

  private async _doGet(): Promise<T | undefined> {
    const { ctx, flags, errors } = this._createContext('get');

    await executePipeline(this._middleware, ctx, async () => {
      await this._ensureDrivers();
      const stored = await degradedGet(this._drivers, this.key, ctx.reportError);
      const { value, meta } = unwrap(stored);
      ctx.value = value;
      Object.assign(ctx.meta, meta);
    });

    await this._applyReadFlags(ctx, flags);

    this._flushErrors(errors);

    return ctx.value as T | undefined;
  }

  /** Honor middleware requestWriteback / requestDelete after a read-side pipeline. */
  private async _applyReadFlags(
    ctx: MiddlewareContext,
    flags: { writeback: boolean; delete: boolean },
  ): Promise<void> {
    if (flags.writeback && ctx.value !== undefined) {
      await this._doSet(ctx.value as T, { meta: ctx.meta, isWriteback: true });
    }
    if (flags.delete && ctx.value === undefined) {
      await degradedDel(this._drivers, this.key);
    }
  }

  private async _doSet(
    value: T,
    options?: { meta?: Record<string, unknown>; isWriteback?: boolean },
  ): Promise<void> {
    const { ctx, errors } = this._createContext('set', value, options?.meta);
    if (options?.isWriteback) {
      ctx.isWriteback = true;
    }

    await executePipeline(this._middleware, ctx, async () => {
      await this._ensureDrivers();
      const wrapped = wrap(ctx.value, ctx.meta);
      await degradedSet(this._drivers, this.key, wrapped, ctx.reportError);
      if (!options?.isWriteback) {
        this._dispatchChange(ctx.value as T | undefined);
      }
    });

    this._flushErrors(errors);
  }

  private _initMiddleware(): void {
    for (const mw of this._middleware) {
      if (isMiddlewareWithHooks(mw) && mw.onInit) {
        mw.onInit({
          key: this.key,
          atomId: this._atomId,
          refresh: () => this._refresh(),
        });
      }
    }
  }

  private _registerScopes(scopes: AtomConfig<T>['scopes']): void {
    for (const scope of scopes) {
      const cleanup = scope._register(async () => {
        if (!this._disposed) {
          await this.del();
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

  private _safeDispatch(event: Event): void {
    if (isBatching()) {
      deferEvent(this.key, this._atomId, this, event);
    } else {
      try {
        this.dispatchEvent(event);
      } catch {
        /* swallow listener errors */
      }
    }
  }

  private _dispatchChange(value: T | undefined): void {
    this._safeDispatch(
      new CustomEvent('change', {
        detail: { value } satisfies AtomChangeEventDetail<T>,
      }),
    );
  }

  private _dispatchDelete(): void {
    this._safeDispatch(new Event('delete'));
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
