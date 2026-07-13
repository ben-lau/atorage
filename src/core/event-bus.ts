import type { Driver } from '../types';

type BusCallback = (event: { type: string; value?: unknown }) => void;

interface Listener {
  callback: BusCallback;
  drivers: Driver[];
}

export interface NotifyOptions {
  skipDriverCheck?: boolean;
}

function sharesDriver(a: Driver[], b: Driver[]): boolean {
  const set = new Set(b);
  return a.some((d) => set.has(d));
}

class EventBus {
  // Map of key -> Map of atomId -> listener
  private _listeners = new Map<string, Map<string, Listener>>();

  register(key: string, atomId: string, drivers: Driver[], callback: BusCallback): void {
    let keyListeners = this._listeners.get(key);
    if (!keyListeners) {
      keyListeners = new Map();
      this._listeners.set(key, keyListeners);
    }
    keyListeners.set(atomId, { callback, drivers });
  }

  unregister(key: string, atomId: string): void {
    const keyListeners = this._listeners.get(key);
    if (!keyListeners) return;

    keyListeners.delete(atomId);
    if (keyListeners.size === 0) {
      this._listeners.delete(key);
    }
  }

  notify(
    key: string,
    sourceAtomId: string,
    sourceDrivers: Driver[],
    event: { type: string; value?: unknown },
    options?: NotifyOptions,
  ): void {
    const keyListeners = this._listeners.get(key);
    if (!keyListeners) return;

    for (const [atomId, { callback, drivers }] of keyListeners) {
      if (atomId === sourceAtomId) continue;
      if (!options?.skipDriverCheck && !sharesDriver(sourceDrivers, drivers)) continue;
      try {
        callback(event);
      } catch {
        /* swallow listener errors */
      }
    }
  }

  _clear(): void {
    this._listeners.clear();
  }
}

// Global singleton
export const eventBus = new EventBus();

// Export type for testing
export type { BusCallback };
