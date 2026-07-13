# Atorage

[![CI](https://github.com/ben-lau/atorage/actions/workflows/ci.yml/badge.svg)](https://github.com/ben-lau/atorage/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/atorage)](https://www.npmjs.com/package/atorage)
[![npm downloads](https://img.shields.io/npm/dm/atorage)](https://www.npmjs.com/package/atorage)
[![codecov](https://codecov.io/gh/ben-lau/atorage/graph/badge.svg)](https://codecov.io/gh/ben-lau/atorage)
[![license](https://img.shields.io/npm/l/atorage)](https://github.com/ben-lau/atorage/blob/main/LICENSE)
[![bundle size](https://img.shields.io/bundlephobia/minzip/atorage)](https://bundlephobia.com/package/atorage)

Type-safe, middleware-composable storage layer for `localStorage`, `sessionStorage`, and `IndexedDB`.

[中文文档](./README.zh-CN.md)

## Features

- **Atomic** — Each storage key is an independent `Atom` with its own driver, middleware, and lifecycle
- **Unified async API** — `get()` / `set()` / `del()` / `has()` / `update()` all return Promises
- **Driver abstraction** — Swap localStorage, sessionStorage, IndexedDB, or custom backends
- **Runtime degradation** — Define a driver chain; if one fails, the next is tried automatically
- **Middleware pipeline** — Onion model with TTL, validation, encryption, compression, caching, debounce, locking, and more
- **Scope management** — Group atoms by scope for batch cleanup (like `AbortController` for storage)
- **Cross-tab sync** — Broadcast changes via `BroadcastChannel` with `tabSync` middleware
- **Type-safe** — Full TypeScript inference, strict mode
- **Framework-agnostic** — Zero runtime dependencies, pure ESM, tree-shakeable

## Install

```bash
pnpm add atorage
```

## Quick Start

```typescript
import { atom, withDriver } from 'atorage';
import { localStorageDriver } from 'atorage/drivers';

const token = atom<string>('auth-token', withDriver(localStorageDriver()));

await token.set('abc123');
console.log(await token.get()); // 'abc123'
console.log(await token.has()); // true
await token.del();
```

## Table of Contents

- [Core Concepts](#core-concepts)
  - [Atom](#atom)
  - [Modifiers](#modifiers)
  - [defineAtom — Preconfigured Factory](#defineatom--preconfigured-factory)
- [Drivers (Storage Backends)](#drivers-storage-backends)
  - [Built-in Drivers](#built-in-drivers)
  - [Runtime Degradation](#runtime-degradation)
  - [Custom Drivers](#custom-drivers)
- [Middleware](#middleware)
  - [ttl — Time-to-Live](#ttl--time-to-live)
  - [validate — Runtime Validation](#validate--runtime-validation)
  - [versioned — Version Migration](#versioned--version-migration)
  - [cached — In-Memory Cache](#cached--in-memory-cache)
  - [debounce — Write Debouncing](#debounce--write-debouncing)
  - [compress — Compression](#compress--compression)
  - [encrypt — Encryption](#encrypt--encryption)
  - [lock — Single-Tab Async Lock](#lock--single-tab-async-lock)
  - [crossTabLock — Cross-Tab Lock](#crosstablock--cross-tab-lock)
  - [tabSync — Cross-Tab Sync](#tabsync--cross-tab-sync)
  - [logger — Logging](#logger--logging)
  - [Middleware Ordering Guide](#middleware-ordering-guide)
  - [Custom Middleware](#custom-middleware)
- [Scopes](#scopes)
- [Batch Operations](#batch-operations)
- [Utilities](#utilities)
- [Debug Tools](#debug-tools)
- [Test Utilities](#test-utilities)
- [Event System](#event-system)
- [Lifecycle](#lifecycle)
- [Architecture](#architecture)
- [Export Structure](#export-structure)
- [Design Decisions & Trade-offs](#design-decisions--trade-offs)
- [Non-Goals](#non-goals)

## Core Concepts

### Atom

An Atom is the core abstraction — an independent storage unit bound to a unique key, configurable with drivers, middleware, and scopes.

```typescript
interface Atom<T> extends EventTarget {
  readonly key: string;

  get(): Promise<T | undefined>;
  set(value: T): Promise<void>;
  del(): Promise<void>;
  has(): Promise<boolean>;
  update(updater: (prev: T | undefined) => T | Promise<T>): Promise<T>;
  getMeta(): Promise<Record<string, unknown> | undefined>;
  dispose(): void;
}
```

| Method       | Description                                                                                                   |
| ------------ | ------------------------------------------------------------------------------------------------------------- |
| `get()`      | Read from driver through the middleware chain. No caching by default; enable `cached()` for in-memory caching |
| `set(value)` | Write to driver through the middleware chain. Dispatches `change` event on success                            |
| `del()`      | Delete value and associated metadata. Dispatches `delete` event on success                                    |
| `has()`      | Check if value exists. Runs through the full middleware chain — TTL-expired keys return `false`               |
| `update(fn)` | Atomic read-modify-write. Internal serial queue ensures concurrency safety. Supports async updaters           |
| `getMeta()`  | Read persisted metadata (TTL expiry, version number, etc.). Read-only, for debugging                          |
| `dispose()`  | Destroy the atom, clean up all subscriptions and resources. Subsequent operations throw `AtomDisposedError`   |

### Modifiers

Modifiers are pure functions that configure an atom's drivers, scopes, and middleware:

```typescript
import { atom, withDriver, withScope, withMiddleware, withPreMiddleware } from 'atorage';

const a = atom<string>(
  'key',
  withDriver(driver), // Specify storage backend (arrays = degradation chain)
  withScope(scope1, scope2), // Specify scopes, determines key prefix
  withMiddleware(ttl(1000), cached()), // Middleware chain (appended)
  withPreMiddleware(validate(fn)), // Middleware chain (prepended before base)
);
```

### defineAtom — Preconfigured Factory

Share configuration across a group of atoms:

```typescript
import { defineAtom, withDriver, withMiddleware } from 'atorage';
import { localStorageDriver } from 'atorage/drivers';
import { encrypt } from 'atorage/middleware';

const secureAtom = defineAtom(() => [
  withDriver(localStorageDriver()),
  withMiddleware(encrypt({ encrypt: myEncrypt, decrypt: myDecrypt })),
]);

const token = secureAtom<string>('token');
const refresh = secureAtom<string>(
  'refresh',
  withPreMiddleware(validate(schema)), // Runs before encrypt
  withMiddleware(logger()), // Runs after encrypt
);
// token   chain: encrypt → driver
// refresh chain: validate → encrypt → logger → driver
```

The factory function receives the `key` as its argument, enabling per-key differentiation:

```typescript
const scopedAtom = defineAtom((key) => [
  withDriver(key.startsWith('temp:') ? memoryDriver() : localStorageDriver()),
]);
```

## Drivers (Storage Backends)

### Built-in Drivers

```typescript
import {
  memoryDriver,
  localStorageDriver,
  sessionStorageDriver,
  indexedDBDriver,
} from 'atorage/drivers';
```

| Driver                   | Storage        | Serialization    | batch | Best For                     |
| ------------------------ | -------------- | ---------------- | ----- | ---------------------------- |
| `memoryDriver()`         | In-memory Map  | None             | ✓     | Testing, SSR, ephemeral data |
| `localStorageDriver()`   | localStorage   | JSON             | —     | Small persistent data        |
| `sessionStorageDriver()` | sessionStorage | JSON             | —     | Tab-scoped session data      |
| `indexedDBDriver(opts?)` | IndexedDB      | Structured clone | ✓     | Large data, Blob/File        |

`indexedDBDriver` options:

```typescript
interface IndexedDBDriverOptions {
  dbName?: string; // Default: 'atorage'
  storeName?: string; // Default: 'kv'
}
```

**Driver interface** — All drivers accept `unknown` values and handle serialization internally:

- localStorage / sessionStorage: Auto `JSON.stringify` / `JSON.parse`
- IndexedDB: Native structured clone, can store `File`, `Blob`, `ArrayBuffer` directly
- memory: Stores references as-is

### Runtime Degradation

Pass a driver array to form a degradation chain:

```typescript
const data = atom(
  'user-prefs',
  withDriver([localStorageDriver(), indexedDBDriver(), memoryDriver()]),
);
```

**Degradation behavior:**

- **Initialization**: Each driver's `available()` filters unsupported drivers (e.g., no localStorage in Node.js)
- **Write**: Tries each driver in order; the first successful one stores data, and stale copies in other drivers are cleaned up
- **Read**: Tries each in order; returns the first non-`undefined` result
- **Delete**: All drivers execute delete

Core guarantee: a key exists in exactly one driver at steady state. When a higher-priority driver recovers, new writes naturally flow back to it.

### Custom Drivers

Implement the `Driver` interface:

```typescript
import type { Driver } from 'atorage';

function redisDriver(url: string): Driver {
  const client = createClient({ url });
  const connected = client.connect();
  return {
    name: 'redis',
    async get(key) {
      await connected;
      return client.get(key);
    },
    async set(key, value) {
      await connected;
      await client.set(key, JSON.stringify(value));
    },
    async del(key) {
      await connected;
      await client.del(key);
    },
    async has(key) {
      await connected;
      return (await client.exists(key)) > 0;
    },
    async keys(prefix) {
      await connected;
      return client.keys(prefix ? `${prefix}*` : '*');
    },
    async dispose() {
      await client.quit();
    },
  };
}
```

Optional methods: `available()` (environment detection) and `batch(ops)` (batch operations).

## Middleware

Middleware uses the onion model — modify `ctx.value` before `next()` to affect downstream, after `next()` to affect the upstream return value.

```typescript
import { withMiddleware } from 'atorage';
import {
  ttl,
  validate,
  versioned,
  cached,
  debounce,
  lock,
  logger,
  tabSync,
  compress,
  encrypt,
  crossTabLock,
} from 'atorage/middleware';
```

### ttl — Time-to-Live

```typescript
const session = atom(
  'session',
  withDriver(d),
  withMiddleware(
    ttl(30 * 60 * 1000), // 30 minutes
  ),
);

// Enable active deletion of expired data from driver
const temp = atom('temp', withDriver(d), withMiddleware(ttl(5000, { deleteOnExpire: true })));
```

- **Write**: Records `exp` (expiry timestamp) in meta
- **Read**: Returns `undefined` when expired; `deleteOnExpire: true` actively cleans driver data
- **`has()`**: Expired keys return `false`
- Default lazy expiry (no active deletion) — industry standard (Redis, Guava), reduces I/O overhead

### validate — Runtime Validation

```typescript
import { validate, ValidationError } from 'atorage/middleware';

const age = atom<number>(
  'age',
  withDriver(d),
  withMiddleware(validate((v) => typeof v === 'number' && v >= 0 && v <= 150)),
);

await age.set(-1); // throws ValidationError

try {
  await age.set(-1);
} catch (err) {
  if (err instanceof ValidationError) {
    // handle invalid write
  }
}
```

- **Write**: Throws `ValidationError` on validation failure, preventing the write
- **Read**: Returns `undefined` on validation failure, notifies via `error` event
- **`ValidationError`** is exported from `atorage/middleware` (not `atorage`) — import it only when using the `validate()` middleware

### versioned — Version Migration

```typescript
const prefs = atom(
  'prefs',
  withDriver(d),
  withMiddleware(
    versioned({
      current: 3,
      migrate: {
        0: (data) => ({ ...data, theme: 'light' }),
        1: (data) => ({ ...data, locale: 'en' }),
        2: (data) => ({ ...data, notifications: true }),
      },
    }),
  ),
);
```

- **Write**: Tags `meta.ver = current`
- **Read**: Detects old versions, runs migrate functions sequentially, then writes back
- Legacy data without `ver` is treated as v0
- Downgrades not supported (throws on higher version data)
- Writeback runs through the full middleware chain, ensuring encrypt/compress etc. process correctly

### cached — In-Memory Cache

```typescript
const myCache = cached();
const config = atom('config', withDriver(d), withMiddleware(myCache));

// Second get() returns from memory — no driver read
await config.get();
await config.get(); // cache hit

// Manually clear cache
myCache.clear();
```

- Caches value to memory after first `get()`
- `set()` updates cache, `del()` clears cache
- Auto-clears when other atoms modify the same key (in-tab) or via cross-tab sync
- Auto-clears on `dispose()`

### debounce — Write Debouncing

```typescript
const myDebounce = debounce(500);
const draft = atom('draft', withDriver(d), withMiddleware(myDebounce));

// Multiple set() within 500ms only trigger one driver write
await draft.set('v1');
await draft.set('v2');
await draft.set('v3');
// Only 'v3' is written to driver

// get() during debounce returns the latest pending value (in memory)
const val = await draft.get(); // 'v3'

// Manually flush to driver immediately
await myDebounce.flush();
```

- Ideal for drag positions, input autosave, and other high-frequency write scenarios
- `change` event fires after actual persistence, not at call time
- `del()` cancels pending writes
- `await set()` resolves after registering the timer, **not after actual persistence**. Persistence failures propagate via atom's `error` event
- When combined with `versioned()`, version migration writebacks are also delayed. Call `flush()` after `get()` on critical paths

### compress — Compression

```typescript
const large = atom(
  'large',
  withDriver(d),
  withMiddleware(
    compress({
      compress: (data) => myCompress(data),
      decompress: (data) => myDecompress(data),
    }),
  ),
);
```

- **Write**: `JSON.stringify` → `compress` → store as string
- **Read**: `decompress` → `JSON.parse`
- Marks compressed data with `meta.cmp = 1`

### encrypt — Encryption

```typescript
const secret = atom(
  'secret',
  withDriver(d),
  withMiddleware(
    encrypt({
      encrypt: (data) => myEncrypt(data),
      decrypt: (data) => myDecrypt(data),
    }),
  ),
);
```

- Same pattern as compress, marks with `meta.enc = 1`
- Encryption implementation is entirely user-provided; AES-GCM or other authenticated algorithms recommended

### lock — Single-Tab Async Lock

```typescript
const counter = atom('counter', withDriver(d), withMiddleware(lock()));
// All operations on this atom instance are serialized
```

### crossTabLock — Cross-Tab Lock

```typescript
const shared = atom('shared', withDriver(d), withMiddleware(crossTabLock()));
// Cross-tab mutual exclusion via Web Locks API (set/del operations only)
```

### tabSync — Cross-Tab Sync

```typescript
const settings = atom('settings', withDriver(d), withMiddleware(tabSync()));
// set()/del() broadcasts to other tabs via BroadcastChannel
```

- Broadcasts only key and operation type, **never the value** — receivers re-read from driver
- Ordering relative to encrypt is irrelevant — no plaintext leak risk
- Custom channel name: `tabSync('my-channel')`

### logger — Logging

```typescript
const item = atom('item', withDriver(d), withMiddleware(logger()));
// [atorage] set item (0.12ms)

// Custom log function
const item2 = atom(
  'item2',
  withDriver(d),
  withMiddleware(logger({ log: (msg) => myLogger.info(msg) })),
);
```

### Middleware Ordering Guide

Middleware ordering is the user's responsibility. Recommended order:

```
validate → ttl → versioned → cached → compress → encrypt → logger
```

**Common pitfall:** `cached()` must come after `ttl()`, otherwise cache hits bypass TTL expiry checks:

```typescript
// ✗ Wrong: cache hit returns directly, ttl cannot check expiry
withMiddleware(cached(), ttl(1000));

// ✓ Correct: ttl checks expiry first, then cache
withMiddleware(ttl(1000), cached());
```

### Custom Middleware

Middleware can be a plain function or an object with lifecycle hooks:

```typescript
import type { MiddlewareFunction, MiddlewareWithHooks, MiddlewareContext } from 'atorage';

// Plain function
const myMiddleware: MiddlewareFunction = async (ctx, next) => {
  // Before next(): intercept/modify request
  console.log(`${ctx.operation} ${ctx.key}`);
  await next();
  // After next(): process/modify response
};

// Object with hooks
function myStatefulMiddleware(): MiddlewareWithHooks {
  let cache: unknown = undefined;
  return {
    handle: async (ctx, next) => {
      // middleware logic
      await next();
    },
    onInit(context) {
      // Called during atom initialization, context contains { key, atomId }
    },
    onExternalChange() {
      // Called when other atoms (in-tab) or cross-tab modify the same key
      cache = undefined;
    },
    onDispose() {
      // Called when atom is disposed
      cache = undefined;
    },
  };
}
```

**MiddlewareContext** capabilities:

| Property/Method      | Description                                                                       |
| -------------------- | --------------------------------------------------------------------------------- |
| `key`                | The atom's storage key                                                            |
| `operation`          | `'get'` / `'set'` / `'del'` / `'has'`                                             |
| `value`              | Current value, readable and writable                                              |
| `meta`               | Metadata object, middleware can read/write synchronously. Core auto wraps/unwraps |
| `requestWriteback()` | Request writeback during get (e.g., after version migration)                      |
| `requestDelete()`    | Request deletion during get (e.g., TTL expiry cleanup)                            |
| `reportError(error)` | Report non-fatal error (dispatches atom's `error` event)                          |

## Scopes

A Scope is a signal broadcaster that does two things: **contributes a key prefix** and **broadcasts clear signals**.

```typescript
import { createScope, withScope, atom, withDriver } from 'atorage';

const userScope = createScope('user:123');

const prefs = atom('prefs', withDriver(d), withScope(userScope));
// Actual storage key: "user:123:prefs"

const history = atom('history', withDriver(d), withScope(userScope));

// Logout: clear all user data at once
const { errors } = await userScope.clear();
// Both prefs and history execute del() (through full middleware chain)
if (errors.length > 0) {
  // Some atoms failed to delete; each error corresponds to a failed del()
  console.warn('Partial clear failure:', errors);
}
```

Multi-level scopes are concatenated by argument order:

```typescript
const auth = createScope('auth');
const session = createScope('session');

const token = atom('token', withScope(auth, session), withDriver(d));
// Actual storage key: "auth:session:token"
```

Scopes are flat and independent — no hierarchy.

## Batch Operations

```typescript
import { batch } from 'atorage';

await batch(async () => {
  await counter.set(1);
  await counter.set(2);
  await counter.set(3);
});
// Only ONE change event fires for counter, value = 3
```

**Semantics:**

- **No transactional atomicity** — if one operation fails, subsequent operations continue
- **Event coalescing** — all `change` / `delete` events during batch are deferred and dispatched after completion
- **Multiple sets on same atom** — only the last change event is dispatched
- **Nested batch** — merges into the outer batch; events defer until the outermost batch completes

## Utilities

```typescript
import { snapshot, restore, clearByPrefix } from 'atorage';
```

### snapshot

```typescript
const data = await snapshot({ driver: d, prefix: 'myapp:' });
// → { 'myapp:key1': value1, 'myapp:key2': value2, ... }
```

Operates on raw driver data, bypasses middleware.

### restore

```typescript
await restore(data, { driver: d });
```

Writes snapshot data to the driver.

### clearByPrefix

```typescript
const count = await clearByPrefix('user:oldId:', { driver: d });
// Returns the number of deleted keys
```

Useful for cleaning up orphaned data (e.g., user switching scenarios).

## Debug Tools

```typescript
import { inspect, raw } from 'atorage/debug';
```

### inspect

```typescript
const info = await inspect(driver, 'my-key');
// → { exists: true, raw: { $v: 'hello', $m: { exp: 1749600000 } }, value: 'hello', meta: { exp: 1749600000 } }
```

### raw — Direct Driver Access

Bypasses middleware and the `{ $v, $m }` wrapper, operates directly on the driver:

```typescript
await raw.get(driver, 'key'); // Read raw stored value
await raw.set(driver, 'key', value); // Write directly
await raw.del(driver, 'key'); // Delete directly
```

For debugging, data migration, and interop with external systems.

## Test Utilities

```typescript
import { testDriver } from 'atorage/test';
```

### testDriver — Driver Conformance Testing

Run the standard conformance test suite against your custom driver:

```typescript
import { testDriver } from 'atorage/test';

testDriver('myDriver', () => createMyDriver());
```

Covers: get missing key, set/get round-trip, has, del, keys, keys(prefix), overwrite, and more.

## Event System

Atom extends `EventTarget`, supporting standard event listeners:

```typescript
const token = atom<string>('token', withDriver(d));

token.addEventListener('change', (e) => {
  const { value } = (e as CustomEvent).detail;
  console.log('Value changed to:', value);
});

token.addEventListener('delete', () => {
  console.log('Value deleted');
});

token.addEventListener('error', (e) => {
  const { error } = (e as CustomEvent).detail;
  console.error('Operation error:', error);
});

// AbortController support
const ac = new AbortController();
token.addEventListener('change', handler, { signal: ac.signal });
ac.abort(); // removes listener
```

| Event    | Trigger                                                                  | detail                      |
| -------- | ------------------------------------------------------------------------ | --------------------------- |
| `change` | Value set, or same key modified by another instance (in-tab / cross-tab) | `{ value: T \| undefined }` |
| `delete` | Value deleted, or scope clear triggers deletion                          | —                           |
| `error`  | Middleware or driver threw an exception                                  | `{ error: Error }`          |

**In-tab auto-sync:** The core includes a built-in event bus. Multiple atom instances sharing the same key within a tab automatically receive `change` events when any one calls `set()`. No `tabSync()` middleware needed for same-tab sync.

## Lifecycle

After `dispose()`, the atom enters a destroyed state:

```typescript
const token = atom<string>('token', withDriver(d));
await token.set('abc');
token.dispose();
await token.get(); // throws AtomDisposedError
```

- Subsequent `get()` / `set()` / `del()` / `has()` / `update()` throw `AtomDisposedError`
- Currently executing async operations complete normally; queued operations are rejected
- Automatically unregisters from event bus, removes scope listeners, calls middleware `onDispose()`
- **Does not release the driver** — drivers may be shared across atoms; their lifecycle is user-managed

## Architecture

```
┌─────────────────────────────────────────────────┐
│  Atom API                                       │  atom(), defineAtom(), batch()
├─────────────────────────────────────────────────┤
│  Middleware Pipeline (Onion Model)              │  validate, ttl, encrypt, ...
├─────────────────────────────────────────────────┤
│  Scope Management                               │  createScope(), key prefixing
├─────────────────────────────────────────────────┤
│  Coordination                                   │  EventBus, lock, tabSync
├─────────────────────────────────────────────────┤
│  Driver (Persistence)                           │  localStorage, indexedDB, memory
└─────────────────────────────────────────────────┘
```

### Storage Format

Value and meta are merged into a single structure, stored with a single I/O operation:

```
{ $v: actualValue, $m: { exp: 1749600000, ver: 3, ... } }
```

- `$v` — actual value
- `$m` — metadata (omitted when empty)
- Core auto wraps/unwraps; middleware and user API see clean separated views

## Export Structure

| Import Path          | Contents                                                                                                                                 |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `atorage`            | Core API: `atom`, `defineAtom`, `createScope`, `batch`, modifiers, types, `AtomDisposedError`, `StorageError`, `snapshot`, `restore`, `clearByPrefix` |
| `atorage/drivers`    | `memoryDriver`, `localStorageDriver`, `sessionStorageDriver`, `indexedDBDriver`                                                         |
| `atorage/middleware` | All preset middleware (including `validate`, `ValidationError`, `ttl`, `encrypt`, …)                                                    |
| `atorage/debug`      | `raw`, `inspect` — debug tools                                                                                                           |
| `atorage/test`       | `testDriver` — driver conformance testing                                                                                                |

## Design Decisions & Trade-offs

### Unified Async API

All operations return Promises, even when the underlying driver (e.g., localStorage) is synchronous. This ensures API consistency so that switching drivers never requires call-site changes. The trade-off is minimal `await` overhead in simple scenarios.

### No Caching by Default

Correctness first. Every `get()` reads from the driver by default, avoiding cache consistency issues. Opt in to caching explicitly via the `cached()` middleware.

### Merged Value + Metadata Storage

The `{ $v, $m }` envelope format guarantees atomic consistency between value and metadata — you can never have a value written but its metadata lost. Single I/O operation, no dual-write issues.

### Lazy TTL Expiry

Expired data is not actively deleted; it's masked on read. This is industry standard (Redis, Guava), reducing I/O overhead on every get. Use `{ deleteOnExpire: true }` or periodic `clearByPrefix` for active cleanup.

### tabSync Doesn't Send Values

Cross-tab sync only broadcasts key + operation type; receivers re-read from the driver. Reasons:

1. BroadcastChannel's structured clone has performance overhead for large objects
2. Encrypted/compressed values are meaningless in another tab without re-running the middleware chain

### Middleware Ordering Is the User's Responsibility

Consistent with Express / Koa middleware models. The library does not implicitly reorder, as different scenarios may require different execution orders.

### `del()` Is Fire-and-Forget

`del()` deletes the value and metadata without returning the old value. If you need the old value, read it first via `get()` or use `update()` for an atomic read-then-delete pattern.

### `has()` Reads the Full Value

`has()` must traverse the full middleware chain (TTL needs to check expiry), so it cannot simply check key existence at the driver level. This adds overhead for large values but ensures semantic correctness.

### dispose Does Not Release Drivers

Drivers may be shared across multiple atoms. Disposing one atom should not destroy a shared resource. Driver lifecycle is user-managed.

### Zero Runtime Dependencies

All functionality including the IndexedDB driver is self-implemented, without external dependencies like `idb-keyval`. Core logic is ~100 lines, maintaining the library's lightweight positioning.

### Error Handling Strategy

Exceptions from middleware or drivers propagate through two channels:

1. **throw** — callers can `try-catch`
2. **error event** — dispatched via EventTarget for global listeners

When all drivers in the degradation chain fail, a `StorageError` is thrown. Partial driver failures (e.g., primary driver throws but fallback succeeds) are reported via the atom's `error` event without interrupting the operation.

Core errors (`AtomDisposedError`, `StorageError`) are exported from `atorage`. Middleware-specific errors (e.g., `ValidationError` from `validate()`) are exported from `atorage/middleware`.

`scope.clear()` returns a `ClearResult` containing any errors from individual atom deletions, rather than silently swallowing failures. Each failed atom also dispatches its own `error` event independently.

## Non-Goals

The following are explicitly out of scope:

- **State management** — no computed / derived atoms; that's the job of Jotai / Zustand
- **Framework bindings** — no built-in React / Vue hooks; integrate via `EventTarget`
- **Quota management / LRU** — atoms are independent; cross-atom eviction decisions don't fit the atomic model. Storage full → driver degradation handles it
- **External change detection** — does not watch DevTools or third-party writes to storage (impossible to unify across all drivers)
- **DevTools browser extension** — not in current version; planned for future iterations

## License

MIT
