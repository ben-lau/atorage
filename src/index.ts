export { atom } from './atom.js'
export { batch } from './batch.js'
export { defineAtom } from './define-atom.js'
export { createScope } from './scope.js'
export {
  withDriver,
  withScope,
  withMiddleware,
  withPreMiddleware,
} from './modifiers.js'

export { AtomDisposedError, StorageError } from './errors.js'

export type {
  Atom,
  AtomModifier,
  AtomConfig,
  AtomChangeEventDetail,
  AtomErrorEventDetail,
  Driver,
  BatchOp,
  Middleware,
  MiddlewareFunction,
  MiddlewareWithHooks,
  MiddlewareContext,
  MiddlewareNext,
  Scope,
} from './types.js'

export { snapshot, restore, clearByPrefix } from './utils/index.js'
export type { SnapshotOptions, RestoreOptions, ClearByPrefixOptions } from './utils/index.js'
