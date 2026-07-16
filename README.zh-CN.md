# Atorage

[![CI](https://github.com/ben-lau/atorage/actions/workflows/ci.yml/badge.svg)](https://github.com/ben-lau/atorage/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/atorage)](https://www.npmjs.com/package/atorage)
[![npm downloads](https://img.shields.io/npm/dm/atorage)](https://www.npmjs.com/package/atorage)
[![codecov](https://codecov.io/gh/ben-lau/atorage/graph/badge.svg)](https://codecov.io/gh/ben-lau/atorage)
[![license](https://img.shields.io/npm/l/atorage)](https://github.com/ben-lau/atorage/blob/main/LICENSE)
[![bundle size](https://img.shields.io/bundlephobia/minzip/atorage)](https://bundlephobia.com/package/atorage)

原子化存储管理库。为 `localStorage`、`sessionStorage`、`IndexedDB` 提供统一的、可组合的、类型安全的管理方案。

[English](./README.md)

## 特性

- **原子化** — 每个存储键是独立的 `Atom`，拥有自己的 driver、中间件和生命周期
- **统一异步 API** — `get()` / `set()` / `del()` / `has()` / `update()` 均返回 Promise
- **Driver 抽象** — 自由切换 localStorage、sessionStorage、IndexedDB 或自定义后端
- **运行时降级** — 定义 driver 链，高优先级失败时自动降级到下一个
- **中间件管线** — 洋葱模型，支持 TTL、校验、加密、压缩、缓存、防抖、锁等
- **作用域管理** — 通过 Scope 将 atom 分组，一键清理（类似 `AbortController`）
- **可选同步** — `sync()` 同 tab 多实例、`tabSync()` 跨 tab；默认互不感知，按需挂载
- **类型安全** — 完整的 TypeScript 类型推导，strict 模式
- **极致轻量** — 核心 ~2 kB min+brotli，含全部 driver 和中间件 < 5 kB
- **零依赖** — 没有任何运行时依赖，包括 IndexedDB driver 在内全部自实现
- **框架无关** — 纯 ESM，tree-shaking 友好，适配任意框架或原生 JS

## 安装

```bash
pnpm add atorage
```

## 快速开始

```typescript
import { atom, withDriver } from 'atorage';
import { localStorageDriver } from 'atorage/drivers';

const token = atom<string>('auth-token', withDriver(localStorageDriver()));

await token.set('abc123');
console.log(await token.get()); // 'abc123'
console.log(await token.has()); // true
await token.del();
```

## 目录

- [核心概念](#核心概念)
  - [Atom](#atom)
  - [Modifier](#modifier)
  - [defineAtom — 预配置工厂](#defineatom--预配置工厂)
- [Driver（存储后端）](#driver存储后端)
  - [内置 Driver](#内置-driver)
  - [运行时降级](#运行时降级)
  - [自定义 Driver](#自定义-driver)
- [中间件](#中间件)
  - [ttl — 过期控制](#ttl--过期控制)
  - [validate — 运行时校验](#validate--运行时校验)
  - [versioned — 版本迁移](#versioned--版本迁移)
  - [cached — 内存缓存](#cached--内存缓存)
  - [debounce — 写入防抖](#debounce--写入防抖)
  - [compress — 压缩](#compress--压缩)
  - [encrypt — 加密](#encrypt--加密)
  - [lock — 单 Tab 异步锁](#lock--单-tab-异步锁)
  - [crossTabLock — 跨 Tab 锁](#crosstablock--跨-tab-锁)
  - [sync — 同 Tab 同步](#sync--同-tab-同步)
  - [tabSync — 跨 Tab 同步](#tabsync--跨-tab-同步)
  - [logger — 日志](#logger--日志)
  - [中间件顺序指南](#中间件顺序指南)
  - [自定义中间件](#自定义中间件)
- [Scope（作用域）](#scope作用域)
- [批量操作](#批量操作)
- [工具函数](#工具函数)
- [调试工具](#调试工具)
- [测试工具](#测试工具)
- [事件系统](#事件系统)
- [生命周期](#生命周期)
- [架构](#架构)
- [导出结构](#导出结构)
- [设计决策与 Trade-offs](#设计决策与-trade-offs)
- [非目标](#非目标)

## 核心概念

### Atom

Atom 是 atorage 的核心抽象——一个独立的存储单元，绑定唯一 key，可配置 driver、中间件和作用域。

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

| 方法         | 说明                                                                         |
| ------------ | ---------------------------------------------------------------------------- |
| `get()`      | 从 driver 读取值，经过中间件链处理。默认不缓存，启用 `cached()` 后走内存缓存 |
| `set(value)` | 写入 driver，经过中间件链处理。成功后触发 `change` 事件                      |
| `del()`      | 删除值及关联元数据。成功后触发 `delete` 事件                                 |
| `has()`      | 判断值是否存在，走完整中间件链。TTL 过期的 key 返回 `false`                  |
| `update(fn)` | 读-改-写原子操作，内部串行队列保证并发安全。支持异步 updater                 |
| `getMeta()`  | 读取持久化元数据（TTL 过期时间、版本号等），只读，用于调试                   |
| `dispose()`  | 销毁 atom，清理所有订阅和资源。后续操作抛出 `AtomDisposedError`              |

### Modifier

Modifier 是纯函数，用于配置 atom 的 driver、scope 和中间件：

```typescript
import { atom, withDriver, withScope, withMiddleware, withPreMiddleware } from 'atorage';

const a = atom<string>(
  'key',
  withDriver(driver), // 指定存储后端（支持数组，表示降级链）
  withScope(scope1, scope2), // 指定作用域，决定 key 前缀
  withMiddleware(ttl(1000), cached()), // 中间件链（追加）
  withPreMiddleware(validate(fn)), // 中间件链（前置插入）
);
```

### defineAtom — 预配置工厂

为一组 atom 共享配置：

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
  withPreMiddleware(validate(schema)), // 在 encrypt 之前执行
  withMiddleware(logger()), // 在 encrypt 之后执行
);
// token  链：encrypt → driver
// refresh 链：validate → encrypt → logger → driver
```

工厂函数接收 `key` 作为参数，支持按 key 差异化配置：

```typescript
const scopedAtom = defineAtom((key) => [
  withDriver(key.startsWith('temp:') ? memoryDriver() : localStorageDriver()),
]);
```

## Driver（存储后端）

### 内置 Driver

```typescript
import {
  memoryDriver,
  localStorageDriver,
  sessionStorageDriver,
  indexedDBDriver,
} from 'atorage/drivers';
```

| Driver                   | 存储介质       | 序列化     | batch | 适用场景            |
| ------------------------ | -------------- | ---------- | ----- | ------------------- |
| `memoryDriver()`         | 内存 Map       | 无         | ✓     | 测试、SSR、临时数据 |
| `localStorageDriver()`   | localStorage   | JSON       | —     | 小型持久化数据      |
| `sessionStorageDriver()` | sessionStorage | JSON       | —     | Tab 级别的会话数据  |
| `indexedDBDriver(opts?)` | IndexedDB      | 结构化克隆 | ✓     | 大数据、Blob/File   |

`indexedDBDriver` 选项：

```typescript
interface IndexedDBDriverOptions {
  dbName?: string; // 默认 'atorage'
  storeName?: string; // 默认 'kv'
}
```

`dbName` 是 IndexedDB 数据库名，`storeName` 是库内的 object store（KV 分区）。同一 `dbName` 下可以使用不同的 `storeName`；若 store 尚不存在，driver 会自动升版本并创建空 KV store。同库的多个 driver 实例共享底层连接；`dispose()` 释放本实例的占用，最后一个空闲时关闭连接。版本号由库内部管理，无需也不支持手动配置。

**Driver 接口**——所有 driver 接收 `unknown` 类型的值，内部自行处理序列化：

- localStorage / sessionStorage：自动 `JSON.stringify` / `JSON.parse`
- IndexedDB：原生结构化克隆，可直接存储 `File`、`Blob`、`ArrayBuffer`
- memory：直接存引用

### 运行时降级

传入 driver 数组，形成降级链：

```typescript
const data = atom(
  'user-prefs',
  withDriver([localStorageDriver(), indexedDBDriver(), memoryDriver()]),
);
```

**降级行为：**

- **初始化**：调用每个 driver 的 `available()` 过滤不支持的 driver（如 Node.js 中过滤 localStorage）
- **写入**：依次尝试，第一个成功的 driver 存储数据，同时清理其他 driver 中的同 key 副本
- **读取**：依次尝试，返回第一个非 `undefined` 的结果
- **删除**：所有 driver 都执行删除

核心保证：一个 key 在稳态下只存在于一个 driver 中。高优先级 driver 恢复可用时，新写入自然回流。

### 自定义 Driver

实现 `Driver` 接口即可：

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

可选方法：`available()`（环境检测）和 `batch(ops)`（批量操作）。

## 中间件

中间件采用洋葱模型，在 `next()` 前修改 `ctx.value` 影响下游，`next()` 后修改影响上游返回值。

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
  sync,
  tabSync,
  compress,
  encrypt,
  crossTabLock,
} from 'atorage/middleware';
```

### ttl — 过期控制

```typescript
const session = atom(
  'session',
  withDriver(d),
  withMiddleware(
    ttl(30 * 60 * 1000), // 30 分钟
  ),
);

// 启用过期后主动删除 driver 数据
const temp = atom('temp', withDriver(d), withMiddleware(ttl(5000, { deleteOnExpire: true })));
```

- **写入**：在 meta 中记录 `exp`（过期时间戳）
- **读取**：过期返回 `undefined`，`deleteOnExpire: true` 时主动清理 driver 数据
- **`has()`**：过期的 key 返回 `false`
- 默认惰性过期（不主动删除），这是业界标准（Redis、Guava），减少 I/O 开销

### validate — 运行时校验

```typescript
import { validate, ValidationError } from 'atorage/middleware';

const age = atom<number>(
  'age',
  withDriver(d),
  withMiddleware(validate((v) => typeof v === 'number' && v >= 0 && v <= 150)),
);

await age.set(-1); // 抛出 ValidationError

try {
  await age.set(-1);
} catch (err) {
  if (err instanceof ValidationError) {
    // 处理非法写入
  }
}
```

- **写入**：校验失败抛出 `ValidationError`，阻止写入
- **读取**：校验失败返回 `undefined`，通过 `error` 事件通知
- **`ValidationError`** 从 `atorage/middleware` 导出（不在 `atorage` 主入口）——仅在使用 `validate()` 中间件时需要 import

### versioned — 版本迁移

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

- **写入**：标记 `meta.ver = current`
- **读取**：检测旧版本，依次执行 migrate 函数升级，然后回写
- 无 `ver` 字段的旧数据视为 v0
- 不支持降级（高版本数据读取时抛错）
- 回写走完整中间件链，保证加密/压缩等中间件正确处理

### cached — 内存缓存

```typescript
const myCache = cached();
const config = atom('config', withDriver(d), withMiddleware(myCache));

// 第二次 get() 直接返回内存缓存，不读 driver
await config.get();
await config.get(); // 缓存命中

// 手动清除缓存
myCache.clear();
```

- 首次 `get()` 后缓存值到内存
- `set()` 更新缓存，`del()` 清除缓存
- 同 Tab 其他 atom 修改同 key 或跨 Tab 同步时自动清除缓存
- `dispose()` 时自动清除

### debounce — 写入防抖

```typescript
const myDebounce = debounce(500);
const draft = atom('draft', withDriver(d), withMiddleware(myDebounce));

// 500ms 内多次 set() 只触发一次 driver 写入
await draft.set('v1');
await draft.set('v2');
await draft.set('v3');
// 只有 'v3' 会被写入 driver

// 防抖期间 get() 返回最新 pending 值（内存中），保证读写一致
const val = await draft.get(); // 'v3'

// 手动立即落盘
await myDebounce.flush();
```

- 适用于拖拽位置、输入框实时保存等高频写入场景
- `change` 事件在实际落盘后触发，非调用时
- `del()` 取消 pending 写入
- `await set()` 在注册 timer 后即 resolve，**不等待实际落盘**。落盘失败通过 atom 的 `error` 事件传播
- 与 `versioned()` 组合时，版本迁移回写也会被延迟。关键路径建议在 `get()` 后手动 `flush()`

### compress — 压缩

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

- **写入**：`JSON.stringify` → `compress` → 存储字符串
- **读取**：`decompress` → `JSON.parse`
- 通过 `meta.cmp = 1` 标记已压缩数据

### encrypt — 加密

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

- 与 compress 同构，通过 `meta.enc = 1` 标记已加密数据
- 加解密实现完全由用户提供，建议使用 AES-GCM 等带认证的算法

### lock — 单 Tab 异步锁

```typescript
const counter = atom('counter', withDriver(d), withMiddleware(lock()));
// 同一 atom 实例上的所有操作串行化
```

### crossTabLock — 跨 Tab 锁

```typescript
const shared = atom('shared', withDriver(d), withMiddleware(crossTabLock()));
// 通过 Web Locks API 跨 tab 互斥（仅 set/del 操作）
```

### sync — 同 Tab 同步

Atom 默认是纯存储句柄，**不会**自动同步同 key 的其他实例。需要时显式挂载：

```typescript
import { sync } from 'atorage/middleware';

const a = atom('token', withDriver(d), withMiddleware(sync()));
const b = atom('token', withDriver(d), withMiddleware(sync()));
await a.set('x'); // b 收到 change（经 refresh 读穿 driver）
```

- 只按 **同 key** 通知 peer 走 `operation: 'refresh'`（不比较 driver/backend）
- Peer 各自读自己的 driver；若后端不同，调用方应保证配置一致
- `refresh`：与 `get` 同类（读穿、发事件；可经中间件标志 writeback/delete）。不是用户 `set`/`del`。`sync`/`tabSync` 只在非 writeback 的 `set`/`del` 后广播（writeback 带 `isWriteback`）

### tabSync — 跨 Tab 同步

```typescript
const settings = atom('settings', withDriver(d), withMiddleware(tabSync()));
// set()/del() 后通过 BroadcastChannel 通知其他 tab
```

- 与 `sync` 平行：只发信号，对端对本实例 `refresh()`
- 仅广播 key 和操作类型，**不传 value**——接收端从 driver 重新读取
- 因此与 encrypt 等中间件的顺序无关，不存在明文泄露风险
- 可自定义 channel 名：`tabSync('my-channel')`

### logger — 日志

```typescript
const item = atom('item', withDriver(d), withMiddleware(logger()));
// [atorage] set item (0.12ms)

// 自定义日志函数
const item2 = atom(
  'item2',
  withDriver(d),
  withMiddleware(logger({ log: (msg) => myLogger.info(msg) })),
);
```

### 中间件顺序指南

中间件顺序由用户负责，推荐顺序：

```
validate → ttl → versioned → compress → encrypt → cached → sync / tabSync → logger
```

`cached()` 缓存的是**该层看到的值**：`set` 时在进入更内层中间件之前快照（因此即便 `encrypt`/`compress` 写在它后面，本地读到的仍是应用层明文）；`get`/`refresh` 未命中时则缓存内层返回后的值。

**常见陷阱：**

```typescript
// ✗ 错误：cache 命中直接返回，ttl 的 after 无法检查过期
withMiddleware(cached(), ttl(1000));

// ✓ 正确：ttl 包住 cached，命中缓存时仍会检查过期
withMiddleware(ttl(1000), cached());
```

更推荐把 `compress` / `encrypt` 写在 `cached` **前面**（外层）。这样 peer `refresh` 用 driver 字节回填缓存时，外层仍会 decrypt/decompress。`cached` 在 `encrypt` 前对「本地 set 后再 get」是安全的（明文快照），但从磁盘回填的路径用「变换包住缓存」更好推理。

### 自定义中间件

中间件可以是纯函数或带生命周期钩子的对象：

```typescript
import type { MiddlewareFunction, MiddlewareWithHooks, MiddlewareContext } from 'atorage';

// 纯函数形式
const myMiddleware: MiddlewareFunction = async (ctx, next) => {
  // next() 前：拦截/修改请求
  console.log(`${ctx.operation} ${ctx.key}`);
  await next();
  // next() 后：处理/修改响应
};

// 带钩子的对象形式
function myStatefulMiddleware(): MiddlewareWithHooks {
  let cache: unknown = undefined;
  return {
    handle: async (ctx, next) => {
      // 当次 IO 上下文；长期状态用 onInit / onDispose
      if (ctx.operation === 'refresh') {
        cache = undefined;
      }
      await next();
    },
    onInit(init) {
      // { key, atomId, refresh } — stable refresh for pools/subscriptions
    },
    onDispose() {
      cache = undefined;
    },
  };
}
```

**MiddlewareContext**（当次 IO）：

| 属性/方法            | 说明                                                                                                                                          |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `key` / `atomId`     | 存储 key 与实例 id                                                                                                                            |
| `operation`          | `'get'` / `'set'` / `'del'` / `'has'` / `'refresh'`（`refresh` 非公开 Atom API；协调器优先用 `onInit.refresh`，管线内也可用 `ctx.refresh()`） |
| `value` / `meta`     | 当前值与元数据（`meta` 保留键：`exp` / `ver` / `enc` / `cmp`）                                                                                |
| `refresh()`          | 触发本实例 refresh（与 `onInit.refresh` 同源；长期 peer 注册优先用 `onInit`）                                                                 |
| `requestWriteback()` | get/refresh 结束后请求带 `isWriteback` 的回写 set（变换仍跑；sync/tabSync 不广播）                                                            |
| `requestDelete()`    | get/refresh/has 结束后请求静默删盘（不走 `del` 管线）                                                                                         |
| `isWriteback`        | 仅对 set 有意义：自动回写（如 migrate）——协调器不得再广播                                                                                     |
| `reportError(error)` | 报告非致命错误（管线结束后刷成 atom `error` 事件）                                                                                            |

## Scope（作用域）

Scope 是注册表，做两件事：**贡献 key 前缀** 和 **`clear()` 时删除已登记 atom**。

```typescript
import { createScope, withScope, atom, withDriver } from 'atorage';

const userScope = createScope('user:123');

const prefs = atom('prefs', withDriver(d), withScope(userScope));
// 实际存储 key: "user:123:prefs"

const history = atom('history', withDriver(d), withScope(userScope));

// 用户登出：一键清理所有用户数据
const { errors } = await userScope.clear();
// prefs 和 history 都会执行 del()（走完整中间件链）
if (errors.length > 0) {
  // 部分 atom 删除失败，每个 error 对应一个失败的 del()
  console.warn('部分清理失败:', errors);
}
```

多级 scope 通过参数顺序拼接前缀：

```typescript
const auth = createScope('auth');
const session = createScope('session');

const token = atom('token', withScope(auth, session), withDriver(d));
// 实际存储 key: "auth:session:token"
```

Scope 之间无层级关系，扁平独立。

## 批量操作

```typescript
import { batch } from 'atorage';

await batch(async () => {
  await counter.set(1);
  await counter.set(2);
  await counter.set(3);
});
// counter 的 change 事件只派发一次，value = 3
```

**语义：**

- **不保证事务原子性**——某个操作失败后，后续操作继续执行
- **事件合并**——batch 期间所有 `change` / `delete` 事件暂存，结束后统一派发
- **同一 atom 多次 set**——只派发最后一次的 change 事件
- **嵌套 batch**——合并到外层，事件延迟到最外层 batch 结束后派发

## 工具函数

```typescript
import { snapshot, restore, clearByPrefix } from 'atorage/utils';
```

### snapshot — 快照

```typescript
const data = await snapshot({ driver: d, prefix: 'myapp:' });
// → { 'myapp:key1': value1, 'myapp:key2': value2, ... }
```

直接操作 driver 层原始数据，不经过中间件。

### restore — 恢复

```typescript
await restore(data, { driver: d });
```

将快照数据写入 driver。

### clearByPrefix — 按前缀清理

```typescript
const count = await clearByPrefix('user:oldId:', { driver: d });
// 返回删除的 key 数量
```

用于清理孤儿数据（如用户切换场景）。

## 调试工具

```typescript
import { inspect, raw } from 'atorage/debug';
```

### inspect — 检查存储数据

```typescript
const info = await inspect(driver, 'my-key');
// → { exists: true, raw: { $v: 'hello', $m: { exp: 1749600000 } }, value: 'hello', meta: { exp: 1749600000 } }
```

### raw — 原始 driver 操作

绕过中间件和 `{ $v, $m }` 包裹，直接操作 driver：

```typescript
await raw.get(driver, 'key'); // 读取原始存储值
await raw.set(driver, 'key', value); // 直接写入
await raw.del(driver, 'key'); // 直接删除
```

用于调试、数据迁移、与外部系统互通。

## 测试工具

```typescript
import { testDriver } from 'atorage/test';
```

### testDriver — Driver 一致性测试

对自定义 driver 运行标准合规测试套件：

```typescript
import { testDriver } from 'atorage/test';
import { describe } from 'vitest';

testDriver('myDriver', () => createMyDriver());
```

覆盖：get 缺失 key、set/get 往返、has、del、keys、keys(prefix)、覆盖写入等。

## 事件系统

Atom 继承 `EventTarget`，支持标准的事件监听：

```typescript
const token = atom<string>('token', withDriver(d));

token.addEventListener('change', (e) => {
  const { value } = (e as CustomEvent).detail;
  console.log('值变更为:', value);
});

token.addEventListener('delete', () => {
  console.log('值被删除');
});

token.addEventListener('error', (e) => {
  const { error } = (e as CustomEvent).detail;
  console.error('操作出错:', error);
});

// 支持 AbortController
const ac = new AbortController();
token.addEventListener('change', handler, { signal: ac.signal });
ac.abort(); // 移除监听
```

| 事件     | 触发时机                                                           | detail                      |
| -------- | ------------------------------------------------------------------ | --------------------------- |
| `change` | 本实例 `set` 成功，或经 `refresh`（如 `sync` / `tabSync`）读到新值 | `{ value: T \| undefined }` |
| `delete` | 本实例 `del` 成功，或 `refresh` 发现值已不存在，或 scope clear     | —                           |
| `error`  | 中间件或 driver 抛出异常                                           | `{ error: Error }`          |

**无隐式同 tab 互通：** Atom 不感知其他实例。需要同步时显式使用 `sync()` / `tabSync()`，它们通过对端 `refresh()` 触发上述事件。

## 生命周期

`dispose()` 调用后，atom 进入已销毁状态：

```typescript
const token = atom<string>('token', withDriver(d));
await token.set('abc');
token.dispose();
await token.get(); // 抛出 AtomDisposedError
```

- 后续 `get()` / `set()` / `del()` / `has()` / `update()` 抛出 `AtomDisposedError`
- 当前正在执行的异步操作会等待完成，排队中的操作被 reject
- 移除 scope 登记、调用中间件 `onDispose()`
- **不释放 driver**——driver 可能被多个 atom 共享，生命周期由用户管理

## 架构

```
┌─────────────────────────────────────────────────┐
│  Atom API（纯句柄）                              │  atom(), defineAtom(), batch()
├─────────────────────────────────────────────────┤
│  Middleware Pipeline（洋葱模型）                  │  validate, ttl, cached, sync, ...
├─────────────────────────────────────────────────┤
│  Scope（注册表）                                  │  createScope(), key 前缀 + clear()
├─────────────────────────────────────────────────┤
│  Coordination（可选中间件私有 pool）               │  sync, tabSync, lock
├─────────────────────────────────────────────────┤
│  Driver（持久化后端）                             │  localStorage, indexedDB, memory
└─────────────────────────────────────────────────┘
```

### 存储格式

Value 和 meta 合并为一个结构体存储，单次 I/O 读写：

```
{ $v: actualValue, $m: { exp: 1749600000, ver: 3, ... } }
```

- `$v` — 实际值
- `$m` — 元数据（无 meta 时省略）
- 核心层自动包裹/解包，中间件和用户 API 看到的都是干净的分离视图

## 导出结构

| 导入路径             | 内容                                                                                                        |
| -------------------- | ----------------------------------------------------------------------------------------------------------- |
| `atorage`            | 核心 API：`atom`、`defineAtom`、`createScope`、`batch`、modifier、类型、`AtomDisposedError`、`StorageError` |
| `atorage/drivers`    | `memoryDriver`、`localStorageDriver`、`sessionStorageDriver`、`indexedDBDriver`                             |
| `atorage/middleware` | 全部预设中间件（含 `sync`、`tabSync`、`cached`、`validate`、`ttl`、`encrypt` 等）                           |
| `atorage/utils`      | `snapshot`、`restore`、`clearByPrefix`                                                                      |
| `atorage/debug`      | `raw`、`inspect` — 调试工具                                                                                 |
| `atorage/test`       | `testDriver` — driver 一致性测试                                                                            |

## 设计决策与 Trade-offs

### 统一全异步 API

所有操作返回 Promise，即使底层 driver（如 localStorage）是同步的。这保证了 API 一致性，使得切换 driver 不需要修改调用代码。代价是简单场景有微小的 await 开销。

### 默认不缓存

正确性优先。每次 `get()` 默认从 driver 真实读取，避免缓存一致性问题。需要缓存时通过 `cached()` 中间件显式启用。

### 元数据与值合并存储

`{ $v, $m }` 信封格式保证 value 和 meta 的原子一致——不可能出现 value 写入但 meta 丢失的情况。单次 I/O 读写，无双写问题。

### TTL 惰性过期

过期数据不主动删除，只在读取时遮蔽。这是业界标准做法（Redis、Guava），减少每次 get 的 I/O 开销。需要主动清理时使用 `{ deleteOnExpire: true }` 或定期调用 `clearByPrefix`。

### tabSync 不传 value

跨 tab 同步只广播 key + 操作类型，接收端从 driver 重新读取。原因：

1. BroadcastChannel 的 structured clone 对大对象有性能开销
2. 加密/压缩后的值在另一个 tab 直接使用无意义，仍需走中间件链

### 中间件顺序是用户责任

与 Express / Koa 中间件模型一致，顺序由用户控制。库不做隐式重排，因为不同场景可能需要不同的执行顺序。

### `del()` 不返回旧值

`del()` 仅删除值和元数据，不返回被删除的值。如需旧值，先通过 `get()` 读取，或使用 `update()` 实现原子的读-删模式。

### `has()` 需要读取完整值

`has()` 需要走完整中间件链（TTL 需要检查过期时间），因此不能在 driver 层直接检查 key 存在性。对大值有额外开销，但保证了语义正确性。

### dispose 不释放 driver

Driver 可能被多个 atom 共享，一个 atom dispose 不应销毁共享资源。Driver 的生命周期由用户管理。

### 零运行时依赖

包括 IndexedDB driver 在内的所有功能均自实现，不引入 `idb-keyval` 等外部依赖。核心逻辑约 100 行，保持库的轻量定位。

### 错误处理策略

中间件或 driver 抛出的异常同时通过两个通道传播：

1. **throw** — 调用者可 `try-catch` 捕获
2. **error 事件** — 通过 EventTarget 派发，供全局监听

降级链中所有 driver 全部失败时，抛出 `StorageError`。部分 driver 失败（如主 driver 抛错但备用 driver 成功）通过 atom 的 `error` 事件上报，不中断操作。

核心错误（`AtomDisposedError`、`StorageError`）从 `atorage` 导出；中间件专属错误（如 `validate()` 的 `ValidationError`）从 `atorage/middleware` 导出。

`scope.clear()` 返回 `ClearResult`，包含各个 atom 删除失败的错误列表，不会静默吞掉失败。每个失败的 atom 也会独立派发自己的 `error` 事件。

## 非目标

以下明确不在 atorage 范围内：

- **状态管理** — 不做 computed / derived atom，这是 Jotai / Zustand 的职责
- **框架绑定** — 不内置 React / Vue hook，用户或社区通过 `EventTarget` 对接
- **配额管理 / LRU** — atom 原子化独立，无法跨 atom 决策淘汰；存储满时由 driver 降级链处理
- **外部变更检测** — 不监听 DevTools 或第三方库对存储的直接修改（无法在所有 driver 上统一实现）
- **DevTools 浏览器扩展** — 当前版本不做，后续迭代

## License

MIT
