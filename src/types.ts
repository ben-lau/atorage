// ── Driver ──────────────────────────────────────────

export interface BatchOp {
  type: 'set' | 'del';
  key: string;
  value?: unknown;
}

export interface Driver {
  name: string;
  /**
   * Identifies the physical storage backend. Drivers sharing the same `backendId`
   * point at the same underlying store (e.g. two `localStorageDriver()` instances).
   * Used by the degradation chain to skip stale cleanup that would delete from itself.
   */
  backendId?: string;

  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  del(key: string): Promise<void>;
  has(key: string): Promise<boolean>;
  keys(prefix?: string): Promise<string[]>;
  dispose(): Promise<void>;

  available?(): Promise<boolean> | boolean;
  batch?(ops: BatchOp[]): Promise<void>;
}

// ── Middleware ───────────────────────────────────────

export interface MiddlewareContext<T = unknown> {
  /** Storage key (after scope prefixes). */
  key: string;
  /** Stable id for this atom instance (not the storage key). */
  atomId: string;
  /**
   * Pipeline kind.
   *
   * `'refresh'` is not a public Atom method. Coordinators start it via
   * `onInit.refresh` (preferred for pools/subscriptions) or `ctx.refresh()`.
   *
   * Like `get`: read-through, run read-side middleware, emit instance events,
   * and may honor `requestWriteback` / `requestDelete`. Unlike a user `set`/`del`,
   * the refresh itself must not be treated as a local write to rebroadcast.
   */
  operation: 'get' | 'set' | 'del' | 'has' | 'refresh';
  value?: T;
  /**
   * Metadata stored alongside the value. Middleware may read/write arbitrary keys.
   *
   * Reserved keys (set by built-in middleware):
   * - `exp` — expiration timestamp in ms (ttl)
   * - `ver` — data version number (versioned)
   * - `enc` — encrypted payload marker (encrypt)
   * - `cmp` — compressed payload marker (compress)
   */
  meta: Record<string, unknown>;
  /**
   * True when this `set` is an automatic writeback after get/refresh
   * (e.g. migration). Only meaningful for `operation === 'set'`.
   * Coordinators (sync/tabSync) must not treat it as a local user write.
   */
  isWriteback?: boolean;
  /**
   * Request a writeback set after the current get/refresh pipeline.
   * Atom runs set with `isWriteback: true` (transforms still apply;
   * sync/tabSync skip rebroadcast). Ignored for other operations.
   */
  requestWriteback(): void;
  /**
   * Request deletion after the current get/refresh/has pipeline
   * (e.g. TTL expiry). Atom uses a silent driver delete, not the `del` pipeline.
   * Ignored for other operations.
   */
  requestDelete(): void;
  /**
   * Report a non-fatal error; flushed as atom `error` events after the pipeline.
   */
  reportError(error: Error): void;
  /**
   * Start a refresh pipeline on this atom (not a public Atom API).
   * Prefer `onInit.refresh` when registering long-lived peers/subscriptions.
   * Nested calls while a refresh is in flight are dropped.
   */
  refresh(): Promise<void>;
}

export interface MiddlewareInit {
  key: string;
  atomId: string;
  /**
   * Stable refresh handle for this atom instance (same as `MiddlewareContext.refresh`).
   * Use in `onInit` for sync pools / BroadcastChannel subscriptions.
   */
  refresh(): Promise<void>;
}

export type MiddlewareNext = () => Promise<void>;

export type MiddlewareFunction = (ctx: MiddlewareContext, next: MiddlewareNext) => Promise<void>;

export interface MiddlewareWithHooks {
  handle: MiddlewareFunction;
  onInit?(init: MiddlewareInit): void;
  onDispose?(context: { key: string; atomId: string }): void;
}

export type Middleware = MiddlewareFunction | MiddlewareWithHooks;

// ── Scope ───────────────────────────────────────────

export interface ClearResult {
  /** Errors from individual atom deletions that failed. Empty means full success. */
  errors: Error[];
}

export interface Scope {
  readonly name: string;
  clear(): Promise<ClearResult>;
  /** @internal */
  _register(cleaner: () => Promise<void>): () => void;
}

// ── Atom ────────────────────────────────────────────

export interface Atom<T> extends EventTarget {
  readonly key: string;

  get(): Promise<T | undefined>;
  set(value: T): Promise<void>;
  del(): Promise<void>;
  has(): Promise<boolean>;
  update(updater: (prev: T | undefined) => T | Promise<T>): Promise<T>;

  getMeta(): Promise<Record<string, unknown> | undefined>;

  dispose(): void;
}

// ── Atom Config (internal) ──────────────────────────

export interface AtomConfig<T = unknown> {
  readonly _phantom?: T;
  drivers: Driver[];
  scopes: Scope[];
  middleware: Middleware[];
  preMiddleware: Middleware[];
}

export type AtomModifier<T = unknown> = (config: AtomConfig<T>) => AtomConfig<T>;

// ── Events ──────────────────────────────────────────

export interface AtomChangeEventDetail<T = unknown> {
  value: T | undefined;
}

export interface AtomErrorEventDetail {
  error: Error;
}
