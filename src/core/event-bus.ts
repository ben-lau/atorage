type BusCallback = (event: { type: string; value?: unknown }) => void

class EventBus {
  // Map of key -> Map of atomId -> callback
  private _listeners = new Map<string, Map<string, BusCallback>>()

  register(key: string, atomId: string, callback: BusCallback): void {
    let keyListeners = this._listeners.get(key)
    if (!keyListeners) {
      keyListeners = new Map()
      this._listeners.set(key, keyListeners)
    }
    keyListeners.set(atomId, callback)
  }

  unregister(key: string, atomId: string): void {
    const keyListeners = this._listeners.get(key)
    if (!keyListeners) return

    keyListeners.delete(atomId)
    if (keyListeners.size === 0) {
      this._listeners.delete(key)
    }
  }

  notify(
    key: string,
    sourceAtomId: string,
    event: { type: string; value?: unknown },
  ): void {
    const keyListeners = this._listeners.get(key)
    if (!keyListeners) return

    for (const [atomId, callback] of keyListeners) {
      if (atomId !== sourceAtomId) {
        callback(event)
      }
    }
  }

  _clear(): void {
    this._listeners.clear()
  }
}

// Global singleton
export const eventBus = new EventBus()

// Export type for testing
export type { BusCallback }
