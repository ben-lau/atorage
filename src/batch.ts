interface BatchContext {
  deferredEvents: Map<string, { atom: EventTarget; event: Event }>;
}

let currentBatch: BatchContext | null = null;

export function isBatching(): boolean {
  return currentBatch !== null;
}

export function deferEvent(
  atomKey: string,
  atomId: string,
  target: EventTarget,
  event: Event,
): void {
  if (!currentBatch) return;
  currentBatch.deferredEvents.set(`${atomId}:${atomKey}`, { atom: target, event });
}

export async function batch(fn: () => Promise<void> | void): Promise<void> {
  if (currentBatch) {
    await fn();
    return;
  }

  currentBatch = {
    deferredEvents: new Map(),
  };

  try {
    await fn();
  } finally {
    const events = currentBatch.deferredEvents;
    currentBatch = null;

    for (const [, { atom, event }] of events) {
      try {
        atom.dispatchEvent(event);
      } catch {
        /* swallow listener errors, consistent with non-batch path */
      }
    }
  }
}
