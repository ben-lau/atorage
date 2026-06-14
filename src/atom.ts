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
} from './types.js'
import { AtomDisposedError, StorageError } from './errors.js'
import { wrap, unwrap } from './core/wrap.js'
import { AsyncMutex } from './core/mutex.js'
import { eventBus } from './core/event-bus.js'
import { executePipeline } from './core/pipeline.js'
import {
  degradedGet,
  degradedSet,
  degradedDel,
} from './core/degradation.js'

let atomIdCounter = 0

function isMiddlewareWithHooks(mw: Middleware): mw is MiddlewareWithHooks {
  return typeof mw !== 'function' && 'handle' in mw
}

function createEmptyConfig<T>(): AtomConfig<T> {
  return {
    drivers: [],
    scopes: [],
    middleware: [],
    preMiddleware: [],
  }
}

class AtomImpl<T> extends EventTarget implements Atom<T> {
  readonly key: string

  private _atomId: string
  private _drivers: Driver[]
  private _middleware: Middleware[]
  private _disposed = false
  private _mutex = new AsyncMutex()
  private _scopeCleanups: Array<() => void> = []

  constructor(key: string, config: AtomConfig<T>) {
    super()
    this._atomId = `atom_${++atomIdCounter}`

    const prefix = config.scopes.map((s) => s.name).join(':')
    this.key = prefix ? `${prefix}:${key}` : key

    this._drivers = config.drivers
    this._middleware = [...config.preMiddleware, ...config.middleware]

    this._registerEventBus()
    this._registerScopes(config.scopes)
    this._filterDrivers()
  }

  // ── Public API ──────────────────────────────────

  get(): Promise<T | undefined>
  get(defaultValue: T): Promise<T>
  get(defaultValue?: T): Promise<T | undefined> {
    this._ensureAlive()
    return this._doGet(defaultValue, false)
  }

  async set(value: T): Promise<void> {
    this._ensureAlive()
    await this._doSet(value)
  }

  async del(): Promise<T | undefined> {
    this._ensureAlive()
    const oldValue = await this._doGet(undefined, false)

    let writebackRequested = false
    const ctx: MiddlewareContext = {
      key: this.key,
      operation: 'del',
      value: oldValue,
      meta: {},
      requestWriteback: () => { writebackRequested = true },
    }

    await executePipeline(this._middleware, ctx, async () => {
      await degradedDel(this._drivers, this.key)
    })

    this._dispatchDelete()
    eventBus.notify(this.key, this._atomId, { type: 'delete' })

    return oldValue as T | undefined
  }

  async has(): Promise<boolean> {
    this._ensureAlive()

    const stored = await degradedGet(this._drivers, this.key)
    const { value, meta } = unwrap(stored)

    let writebackRequested = false
    const ctx: MiddlewareContext = {
      key: this.key,
      operation: 'has',
      value,
      meta,
      requestWriteback: () => { writebackRequested = true },
    }

    await executePipeline(this._middleware, ctx, async () => {})

    return ctx.value !== undefined
  }

  async update(updater: (prev: T | undefined) => T | Promise<T>): Promise<T> {
    this._ensureAlive()
    return this._mutex.run(async () => {
      this._ensureAlive()
      const prev = await this._doGet(undefined, false) as T | undefined
      const next = await updater(prev)
      await this._doSet(next)
      return next
    })
  }

  async getMeta(): Promise<Record<string, unknown> | undefined> {
    this._ensureAlive()
    const stored = await degradedGet(this._drivers, this.key)
    if (stored === undefined) return undefined
    const { meta } = unwrap(stored)
    return Object.keys(meta).length > 0 ? meta : undefined
  }

  async refresh(): Promise<T | undefined> {
    this._ensureAlive()
    return this._doGet(undefined, true)
  }

  dispose(): void {
    if (this._disposed) return
    this._disposed = true

    eventBus.unregister(this.key, this._atomId)

    for (const cleanup of this._scopeCleanups) {
      cleanup()
    }
    this._scopeCleanups = []

    for (const mw of this._middleware) {
      if (isMiddlewareWithHooks(mw) && mw.onDispose) {
        mw.onDispose()
      }
    }
  }

  // ── Internal ────────────────────────────────────

  private async _doGet(
    defaultValue: T | undefined,
    _skipCache: boolean,
  ): Promise<T | undefined> {
    const stored = await degradedGet(this._drivers, this.key)
    const { value, meta } = unwrap(stored)

    let writebackRequested = false
    const ctx: MiddlewareContext = {
      key: this.key,
      operation: 'get',
      value,
      meta,
      requestWriteback: () => { writebackRequested = true },
    }

    await executePipeline(this._middleware, ctx, async () => {})

    if (writebackRequested && ctx.value !== undefined) {
      await this._doWriteback(ctx.value as T, ctx.meta)
    }

    const result = ctx.value !== undefined ? ctx.value : defaultValue
    return result as T | undefined
  }

  private async _doSet(value: T): Promise<void> {
    const ctx: MiddlewareContext = {
      key: this.key,
      operation: 'set',
      value,
      meta: {},
      requestWriteback: () => {},
    }

    await executePipeline(this._middleware, ctx, async () => {
      const wrapped = wrap(ctx.value, ctx.meta)
      await degradedSet(this._drivers, this.key, wrapped)
    })

    this._dispatchChange(ctx.value as T | undefined)
    eventBus.notify(this.key, this._atomId, {
      type: 'change',
      value: ctx.value,
    })
  }

  private async _doWriteback(value: T, meta: Record<string, unknown>): Promise<void> {
    const ctx: MiddlewareContext = {
      key: this.key,
      operation: 'set',
      value,
      meta: { ...meta },
      requestWriteback: () => {},
    }

    await executePipeline(this._middleware, ctx, async () => {
      const wrapped = wrap(ctx.value, ctx.meta)
      await degradedSet(this._drivers, this.key, wrapped)
    })
  }

  private _registerEventBus(): void {
    eventBus.register(this.key, this._atomId, (event) => {
      if (event.type === 'change') {
        this._dispatchChange(event.value as T | undefined)
        for (const mw of this._middleware) {
          if (isMiddlewareWithHooks(mw) && mw.onExternalChange) {
            mw.onExternalChange()
          }
        }
      } else if (event.type === 'delete') {
        this._dispatchDelete()
        for (const mw of this._middleware) {
          if (isMiddlewareWithHooks(mw) && mw.onExternalChange) {
            mw.onExternalChange()
          }
        }
      }
    })
  }

  private _registerScopes(scopes: AtomConfig<T>['scopes']): void {
    for (const scope of scopes) {
      const handler = () => {
        if (!this._disposed) {
          this.del().catch((err) => {
            this._dispatchError(err instanceof Error ? err : new Error(String(err)))
          })
        }
      }
      scope.addEventListener('clear', handler)
      this._scopeCleanups.push(() => scope.removeEventListener('clear', handler))
    }
  }

  private _filterDrivers(): void {
    const filtered: Driver[] = []
    for (const driver of this._drivers) {
      if (driver.available) {
        const result = driver.available()
        if (result instanceof Promise) {
          filtered.push(driver)
        } else if (result) {
          filtered.push(driver)
        }
      } else {
        filtered.push(driver)
      }
    }
    this._drivers = filtered
  }

  private _ensureAlive(): void {
    if (this._disposed) {
      throw new AtomDisposedError(this.key)
    }
  }

  private _dispatchChange(value: T | undefined): void {
    this.dispatchEvent(
      new CustomEvent('change', {
        detail: { value } satisfies AtomChangeEventDetail<T>,
      }),
    )
  }

  private _dispatchDelete(): void {
    this.dispatchEvent(new Event('delete'))
  }

  private _dispatchError(error: Error): void {
    this.dispatchEvent(
      new CustomEvent('error', {
        detail: { error } satisfies AtomErrorEventDetail,
      }),
    )
  }
}

export function atom<T>(
  key: string,
  ...modifiers: AtomModifier<T>[]
): Atom<T> {
  let config = createEmptyConfig<T>()
  for (const modifier of modifiers) {
    config = modifier(config)
  }
  return new AtomImpl<T>(key, config)
}
