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
  key: string;
  operation: 'get' | 'set' | 'del' | 'has';
  value?: T;
  /**
   * Metadata stored alongside the value. Middleware may read/write arbitrary keys.
   *
   * Reserved keys (set by built-in middleware):
   * - `exp` — expiration timestamp in ms (ttl middleware)
   * - `ver` — data version number (versioned middleware)
   */
  meta: Record<string, unknown>;
  requestWriteback(): void;
  requestDelete(): void;
  reportError(error: Error): void;
}

export type MiddlewareNext = () => Promise<void>;

export type MiddlewareFunction = (ctx: MiddlewareContext, next: MiddlewareNext) => Promise<void>;

export interface MiddlewareWithHooks {
  handle: MiddlewareFunction;
  onInit?(context: { key: string; atomId: string }): void;
  onExternalChange?(key: string): void;
  onDispose?(context: { key: string; atomId: string }): void;
}

export type Middleware = MiddlewareFunction | MiddlewareWithHooks;

// ── Scope ───────────────────────────────────────────

export interface ClearResult {
  /** Errors from individual atom deletions that failed. Empty means full success. */
  errors: Error[];
}

export interface Scope extends EventTarget {
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
