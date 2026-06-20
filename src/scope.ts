import type { Scope } from './types';

class ScopeImpl extends EventTarget implements Scope {
  readonly name: string;
  private _cleaners: Array<() => Promise<void>> = [];

  constructor(name: string) {
    super();
    this.name = name;
  }

  _register(cleaner: () => Promise<void>): () => void {
    this._cleaners.push(cleaner);
    return () => {
      const idx = this._cleaners.indexOf(cleaner);
      if (idx >= 0) this._cleaners.splice(idx, 1);
    };
  }

  async clear(): Promise<void> {
    this.dispatchEvent(new Event('clear'));
    await Promise.all(this._cleaners.map((fn) => fn().catch(() => {})));
  }
}

export function createScope(name: string): Scope {
  return new ScopeImpl(name);
}
