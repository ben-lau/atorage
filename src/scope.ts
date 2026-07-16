import type { ClearResult, Scope } from './types';

class ScopeImpl implements Scope {
  readonly name: string;
  private _cleaners: Array<() => Promise<void>> = [];

  constructor(name: string) {
    this.name = name;
  }

  _register(cleaner: () => Promise<void>): () => void {
    this._cleaners.push(cleaner);
    return () => {
      const idx = this._cleaners.indexOf(cleaner);
      if (idx >= 0) this._cleaners.splice(idx, 1);
    };
  }

  async clear(): Promise<ClearResult> {
    const results = await Promise.allSettled(this._cleaners.map((fn) => fn()));

    const errors = results
      .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
      .map((r) => (r.reason instanceof Error ? r.reason : new Error(String(r.reason))));

    return { errors };
  }
}

export function createScope(name: string): Scope {
  return new ScopeImpl(name);
}
