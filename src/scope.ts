import type { Scope } from './types.js'

class ScopeImpl extends EventTarget implements Scope {
  readonly name: string

  constructor(name: string) {
    super()
    this.name = name
  }

  clear(): void {
    this.dispatchEvent(new Event('clear'))
  }
}

export function createScope(name: string): Scope {
  return new ScopeImpl(name)
}
